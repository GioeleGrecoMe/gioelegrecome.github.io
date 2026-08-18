/*
 * Room Scanner V20.1.0 - metric visual-acoustic digital-twin application
 * ------------------------------------------------------------------
 * Smartphone-first browser scanner for connected indoor spaces.
 *
 * User contract:
 *   1. Start WebXR once.
 *   2. Aim at the floor/wall corners and tap each corner.
 *   3. Aim once at a wall/ceiling junction.
 *   4. Walk slowly and look around; keyframes are captured automatically.
 *   5. Walk through a doorway and repeat for the next room.
 *   6. Short ESS sweeps are emitted only at stable, distinct metric poses.
 *   7. End WebXR, then run bounded geometry, Deep and RIR batch processing.
 *
 * Metric/acoustic contract:
 *   - local-floor WebXR coordinates and its continuous pose path are authoritative;
 *   - XR depth continuously feeds a bounded metric surfel map during the walk;
 *   - room topology comes from user corners; surfels can only refine walls locally;
 *   - Depth Anything is scaled per frame from XR/shell anchors after WebXR ends;
 *   - continuous microphone PCM is kept around ESS sweeps, never FFT-processed live;
 *   - unknown hardware latency is eliminated by direct-path alignment per RIR;
 *   - early echoes are associated probabilistically to zones/Gaussians;
 *   - every acoustic estimate carries support, residuals and confidence.
 */
(function roomScannerApplication() {
  'use strict';

  const C = globalThis.RoomScanCore;
  const S = globalThis.RoomScanSignal;
  const G = globalThis.RoomScanGeometry;
  const A = globalThis.RoomScanAcoustics;
  const AudioCapture = globalThis.RoomScanAudio;
  if (!C || !S || !G || !A || !AudioCapture) {
    throw new Error('Moduli V20.1 incompleti: core, signal, geometry, acoustics e audio sono obbligatori');
  }

  const VERSION = '20.1.0';
  const REVISION = 'v20.1.0-metric-rir-twin-20260818';
  const RAW_SCHEMA = 'room-scanner-v20-1-raw';
  const LEGACY_RAW_SCHEMAS = new Set(['room-scanner-v20-raw', 'room-scanner-v15-raw']);
  const CHECKPOINT_DB = 'room-scanner-v20-1-checkpoints';
  const CHECKPOINT_STORE = 'snapshots';
  const CHECKPOINT_KEY = 'latest';
  const HANDOFF_KEY = 'room-scanner-v20-1-post-xr-state';

  const CONFIG = {
    // Keep keyframes deliberately small. Metric scale comes from WebXR, so a
    // phone does not need full camera resolution for the later Deep batch.
    captureLongEdge: 576,
    jpegQuality: 0.82,
    depthGridWidth: 32,
    depthGridHeight: 18,
    minDepth: 0.18,
    maxDepth: 9.0,
    maxFramesPerRoom: 18,
    maxFramesTotal: 72,
    captureGapMs: 1250,
    captureTimeoutMs: 5000,
    // There is no user-facing minimum wall/corner distance in V20. This
    // epsilon only prevents an exactly duplicated point from creating a
    // zero-length normal and invalid triangulation.
    numericalCornerEpsilon: 1e-5,
    numericalAreaEpsilon: 1e-7,
    stableLinearSpeed: 0.24,
    stableAngularSpeed: 0.58,
    viewClusterSize: 0.38,
    // The legacy angular bins are retained only for importing V15.0.x RAW
    // files. User guidance and completion now operate on physical wall tiles.
    coverageBins: 12,
    coverageMinimumFrames: 3,
    coverageMinimumViews: 2,
    coverageTargetFrames: 9,
    coverageTargetViews: 3,
    photoTargetWidth: 1.35,
    photoTargetMaxColumns: 4,
    photoTargetObjectViews: 2,
    photoTargetSurfaceViews: 1,
    photoTargetMinScore: 0.43,
    actionLockMs: 950,
    finishArmMs: 6000,
    runtimeErrorThrottleMs: 1200,
    defaultHeight: 2.70,
    minHeight: 1.85,
    maxHeight: 4.80,
    defaultPortalWidth: 0.95,
    defaultPortalTop: 2.10,
    objectVoxelSize: 0.06,
    objectMinVoxels: 8,
    objectMaxVoxels: 48000,
    deepGridX: 48,
    deepGridY: 32,
    deepToleranceMin: 0.11,
    deepToleranceFraction: 0.055,
    xrToleranceMin: 0.10,
    importMaxBytes: 120 * 1024 * 1024,
    viewerMaxRgbPoints: 6000,
    viewerPointRadiusMin: 1.15,
    viewerPointRadiusMax: 4.2,
    // Continuous metric reconstruction remains bounded and independent of the
    // number of XR frames. Sparse depth is fused roughly four times per second.
    surfelVoxelSize: 0.05,
    surfelMaxCount: 90000,
    surfelFramePeriodMs: 240,
    metricPathPeriodMs: 40,
    metricPathMaxSamples: 24000,
    geometryGaussianCellSize: 0.18,
    geometryGaussianMaxCount: 12000,
    roomFitMaximumAngleDegrees: 4.5,
    roomFitMaximumOffset: 0.26,
    roomFitMaximumCornerShift: 0.38,
    // Acoustic samples are intentionally sparse. Independent positions matter
    // more than firing many sweeps from the same point.
    acousticSweepGapMs: 1650,
    acousticMinimumTranslation: 0.42,
    acousticMinimumYawDegrees: 34,
    acousticMaximumPerRoom: 12,
    acousticStableLinearSpeed: 0.16,
    acousticStableAngularSpeed: 0.42,
    acousticWarmupMs: 900,
    phoneSpeakerOffset: [0.035, -0.075, -0.075],
    phoneMicrophoneOffset: [-0.025, 0.075, 0.055],
    postXrAudioFlushMs: 3400,
  };

  const state = {
    phase: 'idle',
    session: null,
    referenceSpace: null,
    viewerSpace: null,
    hitTestSource: null,
    baseLayer: null,
    gl: null,
    binding: null,
    cameraReader: null,
    xrStarting: false,
    normalEnding: false,
    interrupted: false,
    trackingLost: false,
    currentView: null,
    currentPoseMatrix: null,
    currentProjection: null,
    currentWorldToView: null,
    currentCamera: null,
    lastFrameTime: 0,
    xrStartedAt: -Infinity,
    frameCount: 0,
    capabilities: {
      camera: false,
      depth: false,
      hitTest: false,
      anchors: false,
      planes: false,
      light: false,
    },
    planeSummary: { horizontal: 0, vertical: 0, ceilingY: null },
    hitPoint: null,
    aimPoint: null,
    aimSamples: [],
    heightSamples: [],
    heightCandidate: null,
    anchorQueue: [],
    anchors: [],
    motion: { previous: null, linear: 0, angular: 0 },
    rooms: [],
    roomSequence: 0,
    activeRoomId: null,
    portals: [],
    portalSequence: 0,
    pendingPortalId: null,
    transition: { sourceRoomId: null, path: [], crossing: null, lastPathTime: 0 },
    frames: [],
    frameSequence: 0,
    captureRequest: null,
    captureBusy: false,
    capturePromise: null,
    captureSuspended: false,
    completionPending: false,
    lastCaptureTime: 0,
    actionLockUntil: 0,
    finishArmUntil: 0,
    runtimeError: null,
    runtimeErrorAt: 0,
    objectVoxels: new Map(),
    objects: [],
    objectSequence: 0,
    wallTextures: {},
    textureImages: {},
    surfaceVisualEvidence: {},
    acousticSurfaces: [],
    acoustic: { selectedId: null, bandIndex: 3 },
    // V20.1 metric visual-acoustic products. The surfel map is serialized in
    // compact form, while raw RIR PCM is persisted in its own IndexedDB store.
    surfelMap: new G.MetricSurfelMap({ voxelSize: CONFIG.surfelVoxelSize, maxSurfels: CONFIG.surfelMaxCount }),
    metricPath: [],
    lastMetricPathTime: -Infinity,
    lastSurfelDepthTime: -Infinity,
    geometryGaussians: [],
    geometryFitResults: [],
    acousticZones: { primary: [], gaussians: [], all: [] },
    acousticInference: null,
    rirAnalyses: [],
    audioController: null,
    audio: {
      enabled: true,
      prepared: false,
      preparing: false,
      sourceMode: 'monostatic',
      fixedSourcePosition: null,
      status: 'idle',
      meter: { rms: 0, peak: 0 },
      manifests: [],
      lastSweepPosition: null,
      lastSweepYaw: null,
      lastSweepTime: -Infinity,
      roomSweepCounts: {},
      flashUntil: 0,
      settings: {},
      capabilities: {},
      contextCreation: {},
    },
    worker: null,
    workerEpoch: 0,
    workerSequence: 0,
    workerPending: new Map(),
    depthReady: false,
    depthInputSize: null,
    depthBootPromise: null,
    process: { running: false, cancel: false, total: 0, done: 0, fused: 0, stage: '' },
    logs: [],
    plan: { transform: null, addMode: false, firstPoint: null },
    viewer: { yaw: Math.PI / 4, pitch: -0.62, zoom: 1, pan: [0, 0], focus: null, drag: null, looping: false },
    navigationExitPending: false,
    postXrReady: true,
    handoffPending: false,
    handoffReloadScheduled: false, // retained only for importing V20.0 checkpoints
    handoffRestored: false,
    postXrHandoffPromise: null,
    openReviewAfterEnd: false,
    historyGuardActive: false,
    historyUnwinding: false,
    checkpointDbPromise: null,
    checkpointTimer: null,
    checkpointSaving: false,
    checkpointQueuedReason: null,
    checkpointAvailable: false,
    checkpointLastSavedAt: null,
    // Photo JPEGs are stored as independent IndexedDB records.  Keeping this
    // set avoids cloning every base64 image on each post-XR edit checkpoint.
    checkpointPhotoIds: new Set(),
    initialized: false,
  };

  const $ = id => document.getElementById(id);
  const errorText = error => error?.message || String(error);
  const nowIso = () => new Date().toISOString();
  const nowMs = () => Date.now();
  const degrees = radians => radians * 180 / Math.PI;

  /* -----------------------------------------------------------------------
   * Continuous audio, metric pose path and bounded surfel acquisition
   * -------------------------------------------------------------------- */

  function ensureAudioController() {
    if (state.audioController) return state.audioController;
    const controller = new AudioCapture.AcousticCaptureController({
      workletUrl: './roomscan_audio_worklet_v20_1_0.js',
      sampleRate: 48000,
      sweepF0: 120,
      sweepF1: 15000,
      sweepDurationSeconds: 0.32,
      sweepAmplitude: 0.52,
      tailSeconds: 2.65,
      maximumLatencySeconds: 0.75,
      maximumMeasurements: 96,
    });
    controller.on('status', status => {
      state.audio.status = status;
      state.audio.prepared = status === 'ready' || status === 'recording';
      updateAudioUI();
    });
    controller.on('meter', meter => {
      state.audio.meter = meter;
      updateAudioUI();
    });
    controller.on('sweep', event => {
      state.audio.flashUntil = nowMs() + 180;
      log('ACOUSTIC_SWEEP_EMITTED', 'INFO', event);
      updateAudioUI();
    });
    controller.on('measurement', manifest => {
      const existing = state.audio.manifests.findIndex(item => item.id === manifest.id);
      if (existing >= 0) state.audio.manifests[existing] = manifest;
      else state.audio.manifests.push(manifest);
      log('RIR_CAPTURE_WINDOW_READY', 'INFO', { id: manifest.id, roomId: manifest.roomId, samples: manifest.samples });
      updateAudioUI();
    });
    controller.on('diagnostic', entry => {
      if (entry.event?.includes('error') || entry.event?.includes('unavailable')) log(`AUDIO_${entry.event}`, 'WARN', entry);
    });
    state.audioController = controller;
    return controller;
  }

  function updateAudioUI() {
    const enabled = $('audioEnabled') ? $('audioEnabled').checked : state.audio.enabled;
    state.audio.enabled = Boolean(enabled);
    if ($('sourceMode')) state.audio.sourceMode = $('sourceMode').value || state.audio.sourceMode;
    const controller = state.audioController;
    const summary = controller?.summary?.() || { status: state.audio.status, measurements: state.audio.manifests.length, pending: 0 };
    const prepared = state.audio.prepared;
    const processingActive = state.audio.settings?.echoCancellation === false
      && state.audio.settings?.noiseSuppression === false
      && state.audio.settings?.autoGainControl === false;
    if ($('audioStatus')) {
      $('audioStatus').textContent = !enabled
        ? 'Acustica disattivata: la scansione resterà geometrica.'
        : state.audio.preparing
          ? 'Richiesta microfono e inizializzazione AudioWorklet…'
          : prepared
            ? `${summary.sampleRate || 0} Hz · ${summary.measurements || 0} RIR pronte · ${summary.pending || 0} in acquisizione${processingActive ? ' · elaborazioni browser OFF' : ' · verifica elaborazioni browser'}`
            : 'Audio non inizializzato. Premi “Prepara microfono e chirp”.';
      $('audioStatus').className = `small ${prepared ? (processingActive ? 'good' : 'warn') : ''}`;
    }
    if ($('audioMeterFill')) {
      const meterDb = 20 * Math.log10(Math.max(1e-5, state.audio.meter?.rms || 0));
      $('audioMeterFill').style.width = `${C.clamp((meterDb + 60) / 48) * 100}%`;
    }
    if ($('prepareAudio')) {
      $('prepareAudio').disabled = state.audio.preparing || Boolean(state.session);
      $('prepareAudio').textContent = prepared ? 'Audio pronto · riprova test' : '1 · Prepara microfono e chirp';
    }
    if ($('audioBadge')) {
      const count = state.audio.manifests.length + (summary.pending || 0);
      $('audioBadge').textContent = !enabled ? 'AUDIO OFF' : prepared ? `RIR ${count}` : 'AUDIO NON PRONTO';
      $('audioBadge').classList.toggle('warn', enabled && !prepared);
      $('audioBadge').classList.toggle('good', enabled && prepared);
    }
    if ($('startXR')) {
      const blockedByAudio = enabled && !prepared;
      $('startXR').disabled = state.xrStarting || blockedByAudio;
      $('startXR').title = blockedByAudio ? 'Prepara prima microfono e chirp, oppure disattiva la registrazione acustica.' : '';
    }
  }

  async function prepareAudio() {
    if (state.session || state.audio.preparing) return false;
    state.audio.enabled = $('audioEnabled')?.checked !== false;
    state.audio.sourceMode = $('sourceMode')?.value || 'monostatic';
    if (!state.audio.enabled) {
      updateAudioUI();
      return true;
    }
    const controller = ensureAudioController();
    state.audio.preparing = true;
    updateAudioUI();
    try {
      const summary = await controller.prepare();
      state.audio.prepared = true;
      state.audio.status = summary.status;
      state.audio.settings = { ...(summary.settings || {}) };
      state.audio.capabilities = { ...(summary.capabilities || {}) };
      state.audio.contextCreation = { ...(summary.contextCreation || {}) };
      setBoot(1, 'Audio pronto. Ora avvia WebXR e segui la procedura.', 'good');
      log('AUDIO_PREPARED', 'INFO', summary);
      return true;
    } catch (error) {
      state.audio.prepared = false;
      state.audio.status = 'error';
      setBoot(0, `Audio non disponibile: ${errorText(error)}. Puoi disattivare RIR e continuare solo con la geometria.`, 'bad');
      log('AUDIO_PREPARE_FAILED', 'ERROR', { error: errorText(error) });
      alert(`Impossibile preparare il microfono/chirp: ${errorText(error)}

Disattiva “Registra chirp e RIR” per eseguire una scansione solo geometrica.`);
      return false;
    } finally {
      state.audio.preparing = false;
      updateAudioUI();
    }
  }

  function transformLocalOffset(matrix, offset) {
    return [
      matrix[12] + matrix[0] * offset[0] + matrix[4] * offset[1] + matrix[8] * offset[2],
      matrix[13] + matrix[1] * offset[0] + matrix[5] * offset[1] + matrix[9] * offset[2],
      matrix[14] + matrix[2] * offset[0] + matrix[6] * offset[1] + matrix[10] * offset[2],
    ];
  }

  function phoneAcousticEndpoints(matrix) {
    return {
      source: transformLocalOffset(matrix, CONFIG.phoneSpeakerOffset),
      receiver: transformLocalOffset(matrix, CONFIG.phoneMicrophoneOffset),
    };
  }

  function recordMetricPose(time, matrix) {
    if (!matrix || time - state.lastMetricPathTime < CONFIG.metricPathPeriodMs) return null;
    state.lastMetricPathTime = time;
    const pose = AudioCapture.compactPose(matrix, time, state.trackingLost ? 0.2 : 1);
    if (!pose) return null;
    pose.roomId = state.activeRoomId;
    pose.phase = state.phase;
    state.metricPath.push(pose);
    if (state.metricPath.length > CONFIG.metricPathMaxSamples) {
      state.metricPath.splice(0, state.metricPath.length - CONFIG.metricPathMaxSamples);
    }
    return pose;
  }

  function fuseLiveDepthFrame(frame, view, time) {
    if (time - state.lastSurfelDepthTime < CONFIG.surfelFramePeriodMs) return null;
    if (!['corners', 'height', 'coverage', 'room-ready', 'transition'].includes(state.phase)) return null;
    const grid = sampleDepthGrid(frame, view, CONFIG.depthGridWidth, CONFIG.depthGridHeight);
    state.lastSurfelDepthTime = time;
    if (!grid?.coverage) return null;
    state.capabilities.depth = true;
    const result = state.surfelMap.addDepthFrame({
      id: `xr-live-${state.frameCount}`,
      projection: [...view.projectionMatrix],
      poseMatrix: [...view.transform.matrix],
      depthValues: grid.data,
      depthWidth: grid.width,
      depthHeight: grid.height,
    }, {
      source: 'xr-depth-live',
      weight: 0.75,
      viewId: `path-${Math.floor(time / 400)}`,
      roomId: state.activeRoomId,
      rooms: state.rooms,
      stride: 1,
      minimumDepth: CONFIG.minDepth,
      maximumDepth: CONFIG.maxDepth,
      defaultColor: [132, 151, 162],
    });
    if (state.frameCount % 20 === 0) log('LIVE_SURFEL_FUSION', 'DEBUG', { ...result, total: state.surfelMap.map.size });
    return result;
  }

  function markFixedAcousticSource() {
    if (state.phase !== 'source-mark') return false;
    let point = state.hitPoint || state.aimPoint;
    if (!point && state.currentPoseMatrix) point = transformLocalOffset(state.currentPoseMatrix, [0, 0, -1.2]);
    if (!point) {
      alert('Inquadra il centro dell’altoparlante esterno e riprova.');
      return false;
    }
    state.audio.fixedSourcePosition = [...point];
    state.phase = 'starting-room';
    log('FIXED_ACOUSTIC_SOURCE_MARKED', 'INFO', { position: point });
    beginRoom();
    return true;
  }

  function acousticSweepDistinctEnough(position, yaw) {
    if (!state.audio.lastSweepPosition) return true;
    const translation = C.len3(C.sub3(position, state.audio.lastSweepPosition));
    const rotation = Math.abs(C.angleDiff(yaw, state.audio.lastSweepYaw || 0));
    // Independent receiver positions are the primary source of geometric
    // disambiguation. A large orientation change counts only with a meaningful
    // translation, preventing many chirps from the same point.
    return translation >= CONFIG.acousticMinimumTranslation
      || (translation >= 0.22 && rotation >= Math.max(70, CONFIG.acousticMinimumYawDegrees) * Math.PI / 180);
  }

  function acousticSweepTick(time) {
    if (!state.audio.enabled || !state.audio.prepared || !state.audioController || state.captureSuspended) return null;
    if (state.phase !== 'coverage' || !state.currentPoseMatrix || !state.currentCamera) return null;
    if (time - state.xrStartedAt < CONFIG.acousticWarmupMs || time - state.audio.lastSweepTime < CONFIG.acousticSweepGapMs) return null;
    if (state.motion.linear > CONFIG.acousticStableLinearSpeed || Math.abs(state.motion.angular) > CONFIG.acousticStableAngularSpeed) return null;
    const room = activeRoom();
    if (!room?.model) return null;
    const count = state.audio.roomSweepCounts[room.id] || 0;
    if (count >= CONFIG.acousticMaximumPerRoom) return null;
    const endpoints = phoneAcousticEndpoints(state.currentPoseMatrix);
    const receiverPosition = endpoints.receiver;
    if (!acousticSweepDistinctEnough(receiverPosition, state.currentCamera.yaw)) return null;
    let sourcePosition;
    if (state.audio.sourceMode === 'fixed') {
      sourcePosition = state.audio.fixedSourcePosition;
      if (!sourcePosition) return null;
    } else {
      sourcePosition = endpoints.source;
    }
    const receiverPose = AudioCapture.compactPose(state.currentPoseMatrix, time, 1);
    const scheduled = state.audioController.scheduleSweep({
      roomId: room.id,
      sourceMode: state.audio.sourceMode,
      sourcePosition,
      receiverPosition,
      receiverPose,
      poseMatrix: state.currentPoseMatrix,
      poseConfidence: state.trackingLost ? 0.2 : 1,
      viewId: C.viewClusterId(state.currentPoseMatrix, CONFIG.viewClusterSize),
      minimumGapMs: CONFIG.acousticSweepGapMs - 100,
      metadata: {
        metricPathIndex: state.metricPath.length - 1,
        phase: state.phase,
        surfelsAtCapture: state.surfelMap.map.size,
        receiverLocalOffset: [...CONFIG.phoneMicrophoneOffset],
        sourceLocalOffset: state.audio.sourceMode === 'monostatic' ? [...CONFIG.phoneSpeakerOffset] : null,
      },
    });
    if (!scheduled) return null;
    state.audio.lastSweepPosition = [...receiverPosition];
    state.audio.lastSweepYaw = state.currentCamera.yaw;
    state.audio.lastSweepTime = time;
    state.audio.roomSweepCounts[room.id] = count + 1;
    return scheduled;
  }


  function readHandoffMarker() {
    try {
      const text = globalThis.sessionStorage?.getItem?.(HANDOFF_KEY);
      return text ? JSON.parse(text) : null;
    } catch (error) {
      log('HANDOFF_MARKER_READ_FAILED', 'WARN', { error: errorText(error) });
      return null;
    }
  }

  function writeHandoffMarker(marker) {
    try {
      globalThis.sessionStorage?.setItem?.(HANDOFF_KEY, JSON.stringify(marker));
      return true;
    } catch (error) {
      log('HANDOFF_MARKER_WRITE_FAILED', 'WARN', { error: errorText(error) });
      return false;
    }
  }

  function clearHandoffMarker() {
    try { globalThis.sessionStorage?.removeItem?.(HANDOFF_KEY); } catch {}
  }

  function updateProcessingAvailability() {
    const blocked = Boolean(state.session || state.navigationExitPending || state.handoffPending || !state.postXrReady || state.process.running);
    const reason = state.handoffPending || !state.postXrReady
      ? 'Attendo la chiusura ordinata di WebXR, il flush audio e il salvataggio separato delle RIR.'
      : state.session || state.navigationExitPending
        ? 'Chiudi prima WebXR e salva la scansione.'
        : '';
    for (const id of ['processModel', 'reviewProcess']) {
      const button = $(id);
      if (!button) continue;
      button.disabled = blocked;
      button.title = reason;
      if (id === 'reviewProcess') button.textContent = blocked && reason ? 'Chiusura XR/audio…' : 'Processa metrica + Deep + RIR';
      if (id === 'processModel') button.textContent = blocked && reason ? 'Chiusura XR/audio…' : 'Processa metrica + Deep + RIR';
    }
  }

  function openCheckpointDatabase() {
    if (!globalThis.indexedDB) return Promise.resolve(null);
    if (state.checkpointDbPromise) return state.checkpointDbPromise;
    state.checkpointDbPromise = new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(CHECKPOINT_DB, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(CHECKPOINT_STORE)) {
          database.createObjectStore(CHECKPOINT_STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB non disponibile'));
      request.onblocked = () => reject(new Error('IndexedDB bloccato da un altra scheda'));
    }).catch(error => {
      state.checkpointDbPromise = null;
      log('CHECKPOINT_DB_UNAVAILABLE', 'WARN', { error: errorText(error) });
      return null;
    });
    return state.checkpointDbPromise;
  }

  function checkpointTransaction(database, mode, action) {
    return new Promise((resolve, reject) => {
      try {
        const transaction = database.transaction(CHECKPOINT_STORE, mode);
        const store = transaction.objectStore(CHECKPOINT_STORE);
        let result;
        action(store, value => { result = value; });
        transaction.oncomplete = () => resolve(result);
        transaction.onerror = () => reject(transaction.error || new Error('Transazione checkpoint fallita'));
        transaction.onabort = () => reject(transaction.error || new Error('Transazione checkpoint annullata'));
      } catch (error) {
        reject(error);
      }
    });
  }

  function updateCheckpointUI() {
    const button = $('resumeCheckpoint');
    if (!button) return;
    button.classList.toggle('hidden', !state.checkpointAvailable);
    if (state.checkpointLastSavedAt) {
      const time = new Date(state.checkpointLastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      button.textContent = `Ripristina salvataggio ${time}`;
    } else {
      button.textContent = 'Ripristina ultima scansione';
    }
  }

  function checkpointPhotoKey(frameId) {
    return `photo:${String(frameId)}`;
  }

  function cancelScheduledCheckpoint() {
    if (!state.checkpointTimer) return false;
    clearTimeout(state.checkpointTimer);
    state.checkpointTimer = null;
    return true;
  }

  async function putCheckpointRecord(database, record) {
    return checkpointTransaction(database, 'readwrite', store => { store.put(record); });
  }

  async function getCheckpointRecord(database, key) {
    return checkpointTransaction(database, 'readonly', (store, setResult) => {
      const request = store.get(key);
      request.onsuccess = () => setResult(request.result || null);
      request.onerror = () => setResult(null);
    });
  }

  async function persistCheckpointPhotos(database) {
    let stored = 0;
    for (const frame of state.frames) {
      if (!frame?.jpegDataUrl) continue;
      const id = String(frame.id);
      const key = checkpointPhotoKey(id);
      // A previous, un-restored scan may have used the same numeric frame ID.
      // Skip the write only when this exact in-memory frame was already linked
      // to the record; a fresh frame must overwrite any stale photo:<id> value.
      const alreadyLinked = frame.checkpointPhotoKey === key && state.checkpointPhotoIds.has(id);
      frame.checkpointPhotoKey = key;
      if (alreadyLinked) continue;
      // One transaction per JPEG is intentional.  A single transaction that
      // clones dozens of base64 strings can double peak memory on Android and
      // evict the page immediately after WebXR closes.
      await putCheckpointRecord(database, {
        key,
        frameId: frame.id,
        jpegDataUrl: frame.jpegDataUrl,
        savedAt: nowIso(),
      });
      state.checkpointPhotoIds.add(id);
      stored += 1;
      if (stored % 3 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    return stored;
  }

  async function hydrateCheckpointFrameImages(database, raw) {
    if (!raw?.frames?.length) return 0;
    let restored = 0;
    for (let index = 0; index < raw.frames.length; index += 1) {
      const frame = raw.frames[index];
      if (frame.jpegDataUrl) {
        state.checkpointPhotoIds.add(String(frame.id));
        continue;
      }
      const key = frame.checkpointPhotoKey || checkpointPhotoKey(frame.id);
      const record = await getCheckpointRecord(database, key).catch(() => null);
      if (record?.jpegDataUrl) {
        frame.jpegDataUrl = record.jpegDataUrl;
        frame.checkpointPhotoKey = key;
        state.checkpointPhotoIds.add(String(frame.id));
        restored += 1;
      } else {
        log('CHECKPOINT_PHOTO_MISSING', 'WARN', { frameId: frame.id, key });
      }
      if (index && index % 4 === 0) {
        setBoot(0.60 + 0.14 * index / raw.frames.length, `Ripristino foto ${index}/${raw.frames.length}...`, 'warn');
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    return restored;
  }

  async function persistCheckpoint(reason = 'auto') {
    // Never structured-clone photos or geometry while ARCore owns the camera
    // and WebGL context.  Browser-back and normal completion save only after
    // the XR `end` event has released those resources.
    if (state.session || state.xrStarting || (state.navigationExitPending && state.session)) {
      log('CHECKPOINT_DEFERRED_UNTIL_XR_END', 'INFO', { reason });
      return false;
    }
    if (state.checkpointSaving) {
      state.checkpointQueuedReason = reason;
      return false;
    }
    const database = await openCheckpointDatabase();
    if (!database) return false;
    state.checkpointSaving = true;
    try {
      const savedAt = nowIso();
      const newPhotos = await persistCheckpointPhotos(database);
      // The snapshot contains only lightweight metadata and references to the
      // independently stored JPEG records.  Explicit RAW export remains full.
      const raw = buildRawSnapshot({ checkpoint: true, separateFrameImages: true });
      await putCheckpointRecord(database, { key: CHECKPOINT_KEY, savedAt, reason, raw });
      state.checkpointAvailable = true;
      state.checkpointLastSavedAt = savedAt;
      updateCheckpointUI();
      log('CHECKPOINT_SAVED', 'INFO', {
        reason,
        rooms: raw.rooms.length,
        frames: raw.frames.length,
        newPhotoRecords: newPhotos,
      });
      return true;
    } catch (error) {
      log('CHECKPOINT_SAVE_FAILED', 'WARN', { reason, error: errorText(error) });
      return false;
    } finally {
      state.checkpointSaving = false;
      const queued = state.checkpointQueuedReason;
      state.checkpointQueuedReason = null;
      if (queued) scheduleCheckpoint(queued, 40);
    }
  }

  function scheduleCheckpoint(reason = 'auto', delay = 260) {
    if (!globalThis.indexedDB) return false;
    // Checkpoints during a live XR session caused the exact failure this V20
    // handoff is designed to avoid.  The final `end` event performs the save.
    if (state.session || state.xrStarting || state.navigationExitPending || state.handoffPending) return false;
    cancelScheduledCheckpoint();
    state.checkpointTimer = setTimeout(() => {
      state.checkpointTimer = null;
      persistCheckpoint(reason).catch(() => {});
    }, Math.max(0, delay));
    state.checkpointTimer?.unref?.();
    return true;
  }

  async function readCheckpoint(options = {}) {
    const database = await openCheckpointDatabase();
    if (!database) return null;
    const checkpoint = await getCheckpointRecord(database, CHECKPOINT_KEY).catch(error => {
      log('CHECKPOINT_READ_FAILED', 'WARN', { error: errorText(error) });
      return null;
    });
    if (checkpoint?.raw && options.hydrateFrameImages) {
      await hydrateCheckpointFrameImages(database, checkpoint.raw);
    }
    return checkpoint;
  }

  async function detectCheckpoint() {
    const checkpoint = await readCheckpoint();
    state.checkpointAvailable = Boolean(checkpoint?.raw);
    state.checkpointPhotoIds = new Set((checkpoint?.raw?.frames || [])
      .filter(frame => frame.checkpointPhotoKey || frame.jpegDataUrl)
      .map(frame => String(frame.id)));
    state.checkpointLastSavedAt = checkpoint?.savedAt || null;
    updateCheckpointUI();
    return checkpoint;
  }

  async function deleteCheckpoint() {
    cancelScheduledCheckpoint();
    const database = await openCheckpointDatabase();
    if (database) {
      const photoKeys = new Set([
        ...state.checkpointPhotoIds,
        ...state.frames.filter(frame => frame?.checkpointPhotoKey || frame?.jpegDataUrl).map(frame => String(frame.id)),
      ]);
      await checkpointTransaction(database, 'readwrite', store => {
        store.delete(CHECKPOINT_KEY);
        for (const id of photoKeys) store.delete(checkpointPhotoKey(id));
      }).catch(() => {});
    }
    state.checkpointPhotoIds = new Set();
    state.checkpointAvailable = false;
    state.checkpointLastSavedAt = null;
    updateCheckpointUI();
  }

  async function restoreCheckpoint(options = {}) {
    const checkpoint = await readCheckpoint({ hydrateFrameImages: true });
    if (!checkpoint?.raw) {
      state.checkpointAvailable = false;
      updateCheckpointUI();
      if (!options.silent) alert('Nessun salvataggio automatico disponibile.');
      return false;
    }
    applyRawSnapshot(checkpoint.raw, { restored: !options.handoff, handoff: Boolean(options.handoff) });
    state.checkpointAvailable = true;
    state.checkpointLastSavedAt = checkpoint.savedAt || null;
    state.postXrReady = true;
    state.handoffPending = false;
    state.handoffReloadScheduled = false;
    state.handoffRestored = Boolean(options.handoff);
    updateCheckpointUI();
    updateProcessingAvailability();
    setBoot(1, options.handoff
      ? 'Memoria WebXR liberata. Scansione ripristinata: puoi rivedere o processare.'
      : 'Scansione ripristinata in modalita revisione.', 'good');
    if (options.openReview !== false) openReview();
    return true;
  }

  async function recoverPostXRHandoff() {
    const marker = readHandoffMarker();
    if (!marker || marker.revision !== REVISION) {
      if (marker) clearHandoffMarker();
      await detectCheckpoint();
      state.postXrReady = true;
      updateProcessingAvailability();
      return false;
    }
    const restored = await restoreCheckpoint({ handoff: true, silent: true, openReview: marker.openReview !== false });
    clearHandoffMarker();
    if (!restored) {
      state.postXrReady = true;
      state.handoffPending = false;
      updateProcessingAvailability();
      setBoot(0.55, 'Il riavvio WebXR e terminato, ma il checkpoint non era disponibile. Usa Importa RAW se ne hai esportato uno.', 'warn');
    }
    return restored;
  }

  function armHistoryGuard() {
    if (state.historyGuardActive || !globalThis.history?.pushState) return false;
    try {
      globalThis.history.pushState({ roomScannerGuard: REVISION }, document.title || 'Room Scanner');
      state.historyGuardActive = true;
      return true;
    } catch (error) {
      log('HISTORY_GUARD_FAILED', 'WARN', { error: errorText(error) });
      return false;
    }
  }

  function releaseHistoryGuard() {
    if (!state.historyGuardActive || !globalThis.history?.back) return;
    state.historyGuardActive = false;
    state.historyUnwinding = true;
    try { globalThis.history.back(); } catch {}
    const timer = setTimeout(() => { state.historyUnwinding = false; }, 0);
    timer?.unref?.();
  }

  function openModalId() {
    return ['processModal', 'reviewModal', 'sceneModal', 'planModal']
      .find(id => $(id) && !$(id).classList.contains('hidden')) || null;
  }

  async function handleBrowserBack() {
    if (state.historyUnwinding) {
      state.historyUnwinding = false;
      return false;
    }
    const modalId = openModalId();
    if (modalId && state.session) {
      $(modalId).classList.add('hidden');
      state.historyGuardActive = false;
      armHistoryGuard();
      return true;
    }
    if (!state.session) return false;
    // The guarded history entry has just been consumed by the browser. Do not
    // push it back: close XR, keep this document alive and reveal the review.
    state.historyGuardActive = false;
    await saveAndCloseXR('browser-back');
    return true;
  }

  function activeRoom() {
    return state.rooms.find(room => room.id === state.activeRoomId) || null;
  }

  function roomFrames(roomId) {
    return state.frames.filter(frame => frame.roomId === roomId);
  }

  function activeObjects() {
    return state.objects.filter(object => object.status !== 'removed');
  }

  function log(message, level = 'INFO', data = null) {
    // Diagnostics stays out of the scanner pipeline; this single hook mirrors
    // structured app events into its larger ring buffer when the module exists.
    try { globalThis.RoomScanDiagnostics?.recordAppLog?.(message, level, data); } catch {}
    const suffix = data ? ` ${JSON.stringify(data)}` : '';
    const line = `${new Date().toLocaleTimeString()} [${level}] ${message}${suffix}`;
    state.logs.unshift(line);
    state.logs = state.logs.slice(0, 120);
    const output = $('diagnostics');
    if (output) output.textContent = state.logs.join('\n');
  }

  function actionsLocked() {
    return nowMs() < state.actionLockUntil;
  }

  function lockActions(duration = CONFIG.actionLockMs) {
    state.actionLockUntil = Math.max(state.actionLockUntil, nowMs() + duration);
    updateHUD();
    const timer = setTimeout(() => {
      if (!actionsLocked()) updateHUD();
    }, duration + 30);
    timer?.unref?.();
  }

  function reportRuntimeError(error, source = 'RUNTIME') {
    const message = errorText(error);
    const timestamp = nowMs();
    const repeated = state.runtimeError?.message === message
      && timestamp - state.runtimeErrorAt < CONFIG.runtimeErrorThrottleMs;
    if (repeated) return;
    state.runtimeErrorAt = timestamp;
    state.runtimeError = { source, message, at: nowIso() };
    log('RUNTIME_ERROR_RECOVERED', 'ERROR', state.runtimeError);
    try { globalThis.RoomScanDiagnostics?.captureFault?.(error, source, { phase: state.phase, runtimeError: state.runtimeError }); } catch {}
    updateHUD();
  }

  function setBoot(progress, text, kind = '') {
    if ($('bootFill')) $('bootFill').style.width = `${C.clamp(progress) * 100}%`;
    if ($('bootText')) {
      $('bootText').textContent = text;
      $('bootText').className = `small ${kind}`;
    }
  }

  function requestFullscreen() {
    if (document.fullscreenElement) return Promise.resolve();
    return document.documentElement?.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {}) || Promise.resolve();
  }

  function imageQuality(rgba, width, height) {
    if (!rgba || width < 4 || height < 4) return 0.2;
    let count = 0;
    let edge = 0;
    let mean = 0;
    let meanSquared = 0;
    const step = Math.max(2, Math.floor(Math.min(width, height) / 72));
    for (let y = 1; y < height - 1; y += step) {
      for (let x = 1; x < width - 1; x += step) {
        const index = 4 * (y * width + x);
        const right = index + 4;
        const down = index + 4 * width;
        const luminance = 0.299 * rgba[index] + 0.587 * rgba[index + 1] + 0.114 * rgba[index + 2];
        const luminanceRight = 0.299 * rgba[right] + 0.587 * rgba[right + 1] + 0.114 * rgba[right + 2];
        const luminanceDown = 0.299 * rgba[down] + 0.587 * rgba[down + 1] + 0.114 * rgba[down + 2];
        edge += Math.abs(luminanceRight - luminance) + Math.abs(luminanceDown - luminance);
        mean += luminance;
        meanSquared += luminance * luminance;
        count += 1;
      }
    }
    const edgeMean = edge / Math.max(1, count);
    const brightness = mean / Math.max(1, count);
    const deviation = Math.sqrt(Math.max(0, meanSquared / Math.max(1, count) - brightness * brightness));
    return C.clamp(0.14 + 0.58 * C.clamp(edgeMean / 30) + 0.28 * C.clamp(deviation / 62));
  }

  /* -----------------------------------------------------------------------
   * Raw camera copy. getCameraImage is deliberately reachable only from
   * fulfillCaptureRequest(), which itself is called inside the XR rAF.
   * -------------------------------------------------------------------- */

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'Errore compilazione shader');
    }
    return shader;
  }

  function createCameraReader(gl) {
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, [
      'attribute vec2 position;',
      'varying vec2 uv;',
      'void main(){',
      '  uv=(position+1.0)*0.5;',
      '  gl_Position=vec4(position,0.0,1.0);',
      '}',
    ].join('\n'));
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, [
      'precision mediump float;',
      'uniform sampler2D cameraTexture;',
      'varying vec2 uv;',
      'void main(){',
      '  gl_FragColor=texture2D(cameraTexture,vec2(uv.x,1.0-uv.y));',
      '}',
    ].join('\n'));
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'Errore link shader camera');
    }
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const reader = {
      program,
      vertexShader,
      fragmentShader,
      vertexBuffer,
      positionLocation: gl.getAttribLocation(program, 'position'),
      cameraLocation: gl.getUniformLocation(program, 'cameraTexture'),
      framebuffer: null,
      targetTexture: null,
      width: 0,
      height: 0,
      pixels: null,
    };
    reader.dispose = () => {
      try {
        if (reader.targetTexture) gl.deleteTexture(reader.targetTexture);
        if (reader.framebuffer) gl.deleteFramebuffer(reader.framebuffer);
        gl.deleteBuffer(reader.vertexBuffer);
        gl.deleteProgram(reader.program);
        gl.deleteShader(reader.vertexShader);
        gl.deleteShader(reader.fragmentShader);
      } catch {
        // Best-effort cleanup after a context/session shutdown.
      }
    };
    return reader;
  }

  function ensureCameraTarget(reader, width, height) {
    if (reader.width === width && reader.height === height && reader.framebuffer) return;
    const gl = state.gl;
    if (reader.targetTexture) gl.deleteTexture(reader.targetTexture);
    if (reader.framebuffer) gl.deleteFramebuffer(reader.framebuffer);
    reader.targetTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, reader.targetTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    reader.framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, reader.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, reader.targetTexture, 0);
    reader.width = width;
    reader.height = height;
    reader.pixels = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function readCameraRGBA(view, longEdge = CONFIG.captureLongEdge) {
    if (!state.binding || !state.cameraReader || !view?.camera) return null;
    const gl = state.gl;
    const reader = state.cameraReader;
    const cameraWidth = Math.max(1, view.camera.width || 1280);
    const cameraHeight = Math.max(1, view.camera.height || 720);
    const scale = Math.min(1, longEdge / Math.max(cameraWidth, cameraHeight));
    const width = Math.max(2, Math.round(cameraWidth * scale));
    const height = Math.max(2, Math.round(cameraHeight * scale));
    ensureCameraTarget(reader, width, height);
    const cameraTexture = state.binding.getCameraImage(view.camera);
    if (!cameraTexture) return null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, reader.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.useProgram(reader.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, reader.vertexBuffer);
    gl.enableVertexAttribArray(reader.positionLocation);
    gl.vertexAttribPointer(reader.positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cameraTexture);
    gl.uniform1i(reader.cameraLocation, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, reader.pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { rgba: new Uint8ClampedArray(reader.pixels), width, height };
  }

  function rgbaToJpeg(rgba, width, height, quality = CONFIG.jpegQuality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    try {
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
      return canvas.toDataURL('image/jpeg', quality);
    } finally {
      // Resetting the backing store makes the large raster collectible before
      // the next XR frame instead of waiting for a browser-specific GC cycle.
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  async function jpegToRGBA(dataUrl) {
    if (!dataUrl) throw new Error('JPEG keyframe non disponibile nel checkpoint');
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const width = image.naturalWidth;
        const height = image.naturalHeight;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        try {
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0);
          // Copy out of ImageData before shrinking the canvas.  Returning the
          // browser-owned buffer can keep the complete raster surface alive.
          const rgba = new Uint8ClampedArray(context.getImageData(0, 0, width, height).data);
          resolve({ rgba, width, height });
        } catch (error) {
          reject(error);
        } finally {
          canvas.width = 1;
          canvas.height = 1;
          image.onload = null;
          image.onerror = null;
          try { image.src = ''; } catch {}
        }
      };
      image.onerror = () => {
        image.onload = null;
        image.onerror = null;
        reject(new Error('Immagine keyframe non decodificabile'));
      };
      image.src = dataUrl;
    });
  }

  async function ensureFrameRGBA(frame) {
    if (frame.rgba) return frame;
    if (!frame.jpegDataUrl) throw new Error(`Foto ${frame.id ?? '?'} assente dal checkpoint`);
    const decoded = await jpegToRGBA(frame.jpegDataUrl);
    frame.rgba = decoded.rgba;
    frame.rgbWidth = decoded.width;
    frame.rgbHeight = decoded.height;
    return frame;
  }

  function colorAt(frame, u, v) {
    if (!frame.rgba) return [175, 190, 200];
    const x = C.clamp(Math.floor(u * frame.rgbWidth), 0, frame.rgbWidth - 1);
    const y = C.clamp(Math.floor(v * frame.rgbHeight), 0, frame.rgbHeight - 1);
    const index = 4 * (y * frame.rgbWidth + x);
    return [frame.rgba[index], frame.rgba[index + 1], frame.rgba[index + 2]];
  }

  function getCpuDepth(frame, view) {
    try {
      const depth = frame.getDepthInformation?.(view);
      return depth && typeof depth.getDepthInMeters === 'function' ? depth : null;
    } catch {
      return null;
    }
  }

  function sampleDepthGrid(frame, view, width = CONFIG.depthGridWidth, height = CONFIG.depthGridHeight) {
    const depthInformation = getCpuDepth(frame, view);
    if (!depthInformation) return null;
    const data = new Float32Array(width * height);
    let valid = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const u = (x + 0.5) / width;
        const v = (y + 0.5) / height;
        const depth = depthInformation.getDepthInMeters(u, v);
        if (depth >= CONFIG.minDepth && depth <= CONFIG.maxDepth) {
          data[y * width + x] = depth;
          valid += 1;
        }
      }
    }
    return { width, height, data, coverage: valid / (width * height) };
  }

  function depthGridAt(grid, u, v) {
    if (!grid) return null;
    const x = C.clamp(Math.floor(u * grid.width), 0, grid.width - 1);
    const y = C.clamp(Math.floor(v * grid.height), 0, grid.height - 1);
    const value = grid.data[y * grid.width + x];
    return value > 0 ? value : null;
  }

  /* -----------------------------------------------------------------------
   * WebXR session lifecycle
   * -------------------------------------------------------------------- */

  function requestXRSession() {
    if (!navigator.xr) throw new Error('WebXR non disponibile su questo browser');
    return navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['local-floor', 'dom-overlay', 'camera-access'],
      optionalFeatures: ['hit-test', 'anchors', 'plane-detection', 'mesh-detection', 'depth-sensing', 'light-estimation'],
      domOverlay: { root: document.body },
      depthSensing: {
        usagePreference: ['cpu-optimized'],
        dataFormatPreference: ['float32', 'unsigned-short', 'luminance-alpha'],
      },
    });
  }

  async function startXR() {
    if (state.session || state.xrStarting) return;
    state.audio.enabled = $('audioEnabled')?.checked !== false;
    state.audio.sourceMode = $('sourceMode')?.value || 'monostatic';
    if (state.audio.enabled && !state.audio.prepared) {
      alert('Prepara prima microfono e chirp. In alternativa disattiva la registrazione acustica per una scansione solo geometrica.');
      updateAudioUI();
      return;
    }
    if (state.rooms.length && ['finished', 'processed'].includes(state.phase)) {
      alert('Questa scansione usa un reference space gia chiuso. Esporta i dati e premi “Nuova scansione” prima di avviare un altro ambiente.');
      return;
    }
    if (state.interrupted && state.rooms.length) {
      alert('La sessione metrica precedente si e interrotta. I dati esistenti restano revisionabili, ma non possono essere continuati in un nuovo reference space come se fossero allineati. Esporta o processa la scansione corrente.');
      return;
    }
    state.xrStarting = true;
    $('startXR').disabled = true;
    destroyDepthWorker('RAM liberata prima di WebXR');
    let session = null;
    try {
      setBoot(0.08, 'Richiesta WebXR, camera e local-floor...');
      // The request is issued directly in the click activation path. Do not add
      // an awaited preflight or a second requestSession retry here.
      const sessionPromise = requestXRSession();
      requestFullscreen();
      session = await sessionPromise;
      const canvas = $('arCanvas');
      const gl = canvas.getContext('webgl', { xrCompatible: true, alpha: true, antialias: false })
        || canvas.getContext('webgl2', { xrCompatible: true, alpha: true, antialias: false });
      if (!gl) throw new Error('WebGL non disponibile');
      await gl.makeXRCompatible?.();
      const referenceSpace = await session.requestReferenceSpace('local-floor');
      const baseLayer = new XRWebGLLayer(session, gl, { alpha: true, antialias: false });
      session.updateRenderState({ baseLayer });

      state.session = session;
      state.referenceSpace = referenceSpace;
      state.baseLayer = baseLayer;
      state.gl = gl;
      state.binding = typeof XRWebGLBinding !== 'undefined' ? new XRWebGLBinding(session, gl) : null;
      state.cameraReader = state.binding ? createCameraReader(gl) : null;
      state.capabilities.camera = Boolean(state.cameraReader);
      if (!state.cameraReader) {
        throw new Error('Raw Camera Access WebXR non esposto dal dispositivo');
      }
      state.viewerSpace = await session.requestReferenceSpace('viewer').catch(() => null);
      if (state.viewerSpace && session.requestHitTestSource) {
        state.hitTestSource = await session.requestHitTestSource({ space: state.viewerSpace }).catch(() => null);
        state.capabilities.hitTest = Boolean(state.hitTestSource);
      }
      if (session.requestLightProbe) {
        session.requestLightProbe().then(() => {
          state.capabilities.light = true;
          updateCapabilityBadges();
          updateAudioUI();
        }).catch(() => {});
      }
      session.addEventListener('end', onXREnd, { once: true });
      state.phase = state.audio.enabled && state.audio.sourceMode === 'fixed' && !state.audio.fixedSourcePosition ? 'source-mark' : 'starting';
      state.trackingLost = false;
      state.normalEnding = false;
      state.captureSuspended = false;
      state.navigationExitPending = false;
      state.openReviewAfterEnd = false;
      state.frameCount = 0;
      state.xrStartedAt = performance.now();
      state.lastMetricPathTime = -Infinity;
      state.lastSurfelDepthTime = -Infinity;
      state.audioController?.resumeScheduling?.();
      $('welcome').classList.add('hidden');
      $('arCanvas').classList.remove('hidden');
      $('overlayCanvas').classList.remove('hidden');
      $('screenTint').classList.remove('hidden');
      $('hud').classList.remove('hidden');
      document.body.classList.add('xr-active');
      armHistoryGuard();
      session.requestAnimationFrame(onXRFrame);
      log('XR_STARTED', 'INFO', { revision: REVISION, acoustic: state.audio.enabled, sourceMode: state.audio.sourceMode });
      updateHUD();
    } catch (error) {
      // A failure may happen after requestSession succeeded (for example while
      // creating the raw-camera reader). Remove our end listener first so this
      // controlled cleanup is not misreported as an interrupted metric scan.
      if (session) {
        try { session.removeEventListener('end', onXREnd); } catch {}
        try { await session.end(); } catch {}
      }
      if (state.session === session) state.session = null;
      releaseHistoryGuard();
      cleanupXRResources();
      $('arCanvas').classList.add('hidden');
      $('overlayCanvas').classList.add('hidden');
      $('hud').classList.add('hidden');
      $('screenTint').classList.add('hidden');
      $('welcome').classList.remove('hidden');
      document.body.classList.remove('xr-active');
      if (!state.rooms.some(room => room.model)) state.phase = 'idle';
      setBoot(0, `WebXR non avviato: ${errorText(error)}`, 'bad');
      log('XR_START_FAILED', 'ERROR', { error: errorText(error) });
      alert(`Impossibile avviare la scansione: ${errorText(error)}`);
    } finally {
      state.xrStarting = false;
      // Re-evaluate the audio gate instead of blindly enabling the button.
      // Otherwise a failed XR launch could allow a second launch without the
      // microphone/AudioWorklet being prepared.
      updateAudioUI();
    }
  }

  function cleanupXRResources() {
    if (state.captureRequest) {
      clearTimeout(state.captureRequest.timeoutId);
      try { state.captureRequest.reject(new Error('Sessione XR terminata durante lo scatto')); } catch {}
      state.captureRequest = null;
      state.captureBusy = false;
      state.capturePromise = null;
    }
    state.completionPending = false;
    state.finishArmUntil = 0;
    state.actionLockUntil = 0;
    try { state.hitTestSource?.cancel?.(); } catch {}
    try { state.cameraReader?.dispose?.(); } catch {}
    for (const anchor of state.anchors) {
      try { anchor.delete?.(); } catch {}
    }
    // Camera/depth/ARCore resources are released before audio persistence or
    // ONNX starts. Losing the WebGL context keeps peak memory bounded without
    // destroying or reloading the document.
    const gl = state.gl;
    try {
      gl?.bindFramebuffer?.(gl.FRAMEBUFFER, null);
      gl?.finish?.();
      gl?.getExtension?.('WEBGL_lose_context')?.loseContext?.();
    } catch (error) {
      log('XR_CONTEXT_RELEASE_WARNING', 'WARN', { error: errorText(error) });
    }
    const arCanvas = $('arCanvas');
    if (arCanvas) {
      try { arCanvas.width = 1; arCanvas.height = 1; } catch {}
    }
    state.hitTestSource = null;
    state.cameraReader = null;
    state.binding = null;
    state.baseLayer = null;
    state.viewerSpace = null;
    state.referenceSpace = null;
    state.gl = null;
    state.currentView = null;
    state.currentPoseMatrix = null;
    state.currentProjection = null;
    state.currentWorldToView = null;
    state.currentCamera = null;
    state.anchors = [];
    state.anchorQueue = [];
    state.aimSamples = [];
    state.heightSamples = [];
    for (const frame of state.frames) {
      frame.rgba = null;
      frame.deep = null;
    }
  }

  async function completePostXRHandoff(wasNormal, shouldOpenReview) {
    // This function is invoked only after the XR `end` event and after camera,
    // depth objects, anchors and the WebGL context have been released. No
    // reload is used: Android Chrome may evict the page while detaching the XR
    // compositor, which was the source of the previous transition crash.
    state.postXrReady = false;
    state.handoffPending = Boolean(state.rooms.length);
    state.handoffReloadScheduled = false;
    updateProcessingAvailability();
    clearHandoffMarker();

    let audioStored = 0;
    if (state.audio.enabled && state.audioController) {
      setBoot(0.72, 'WebXR chiuso. Completo le finestre PCM e salvo ogni RIR separatamente…', 'warn');
      try {
        await state.audioController.stop({
          flush: true,
          persist: true,
          maximumWaitMs: CONFIG.postXrAudioFlushMs,
        });
        state.audio.manifests = state.audioController.measurements.map(record => state.audioController.measurementManifest(record));
        state.audio.prepared = false;
        state.audio.status = 'stopped';
        audioStored = state.audio.manifests.length;
        log('POST_XR_AUDIO_FLUSH_COMPLETE', 'INFO', { measurements: audioStored });
      } catch (error) {
        // Geometry remains valuable even if the browser audio route vanished
        // during XR shutdown. Keep partial manifests and expose the failure.
        state.audio.manifests = state.audioController.measurements.map(record => state.audioController.measurementManifest(record));
        state.audio.prepared = false;
        state.audio.status = 'error';
        log('POST_XR_AUDIO_FLUSH_FAILED', 'ERROR', { error: errorText(error), partial: state.audio.manifests.length });
        setBoot(0.76, `WebXR chiuso; salvataggio audio parziale: ${errorText(error)}`, 'warn');
      }
    }

    let checkpointReady = false;
    if (state.rooms.length) {
      setBoot(0.84, 'Salvo foto, traiettoria, surfel metrici e manifest RIR…', 'warn');
      try {
        checkpointReady = await persistCheckpoint(wasNormal ? 'post-xr-safe-handoff-v20-1' : 'unexpected-xr-safe-handoff-v20-1');
      } catch (error) {
        log('POST_XR_CHECKPOINT_FAILED', 'ERROR', { error: errorText(error) });
      }
    }

    state.postXrReady = true;
    state.handoffPending = false;
    state.navigationExitPending = false;
    state.captureSuspended = false;
    updateProcessingAvailability();
    renderReview();
    renderPlan();
    updateLandingSummary();
    updateAudioUI();
    if (shouldOpenReview && state.rooms.length) openReview();

    if (state.rooms.length) {
      setBoot(
        1,
        `${checkpointReady ? 'Salvataggio completato' : 'Dati conservati in memoria'} · ${state.surfelMap.map.size} surfel metrici · ${audioStored} RIR. Processing pronto.`,
        checkpointReady ? 'good' : 'warn',
      );
    } else {
      setBoot(1, 'WebXR chiuso e risorse rilasciate.', 'good');
    }
    // Any fault recorded while XR was active is offered only after the safe
    // handoff, so confirm()/export cannot interfere with camera/audio teardown.
    try { globalThis.RoomScanDiagnostics?.maybePrompt?.().catch?.(() => {}); } catch {}
    return checkpointReady || !state.rooms.length;
  }

  function onXREnd() {
    const wasNormal = state.normalEnding;
    const shouldOpenReview = state.openReviewAfterEnd || (!wasNormal && state.rooms.length > 0);
    // The session reference is cleared before any persistence.  Resource
    // disposal is deliberately the first substantial operation after `end`.
    state.session = null;
    cleanupXRResources();
    $('arCanvas').classList.add('hidden');
    $('overlayCanvas').classList.add('hidden');
    $('hud').classList.add('hidden');
    $('screenTint').classList.add('hidden');
    $('welcome').classList.remove('hidden');
    document.body.classList.remove('xr-active');
    if (!wasNormal) {
      state.interrupted = true;
      const room = activeRoom();
      if (room && room.status !== 'complete') room.status = room.model ? 'partial' : 'draft';
      state.phase = state.rooms.length ? 'finished' : 'idle';
      setBoot(0.65, 'WebXR si è chiuso: libero camera/WebGL, poi salvo PCM, RIR e geometria.', 'warn');
      log('XR_ENDED_UNEXPECTED_BUT_RECOVERED', 'WARN');
      try { globalThis.RoomScanDiagnostics?.captureFault?.(new Error('WebXR ended unexpectedly'), 'XR_ENDED_UNEXPECTED', { phase: state.phase, rooms: state.rooms.length, frames: state.frames.length }); } catch {}
    } else {
      setBoot(0.7, 'Acquisizione terminata. Completo audio e salvataggio senza ricaricare la pagina.', 'good');
      log('XR_ENDED_NORMAL');
    }
    state.normalEnding = false;
    state.captureSuspended = false;
    state.navigationExitPending = false;
    state.openReviewAfterEnd = false;
    // Set the handoff guard before history unwinding can dispatch popstate or
    // pagehide.  Those events must not start a competing checkpoint.
    state.handoffPending = Boolean(state.rooms.length);
    state.postXrReady = !state.rooms.length;
    updateProcessingAvailability();
    releaseHistoryGuard();
    state.postXrHandoffPromise = completePostXRHandoff(wasNormal, shouldOpenReview).catch(error => {
      state.handoffPending = false;
      state.postXrReady = true;
      updateProcessingAvailability();
      renderReview();
      updateLandingSummary();
      if (shouldOpenReview && state.rooms.length) openReview();
      log('POST_XR_HANDOFF_FAILED', 'ERROR', { error: errorText(error) });
      try { globalThis.RoomScanDiagnostics?.captureFault?.(error, 'POST_XR_HANDOFF_FAILED', { phase: state.phase }); } catch {}
      setBoot(0.75, `Chiusura post-XR incompleta: ${errorText(error)}. I dati rimasti in memoria possono ancora essere esportati.`, 'bad');
      return false;
    });
    return state.postXrHandoffPromise;
  }

  function findCameraView(pose) {
    if (!pose?.views?.length) return null;
    return pose.views.find(view => view.camera) || pose.views[0];
  }

  function clearXRLayer(pose) {
    const gl = state.gl;
    const layer = state.baseLayer;
    if (!gl || !layer) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    for (const view of pose.views) {
      const viewport = layer.getViewport(view);
      if (!viewport) continue;
      gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function updateMotion(time, worldFromView) {
    const position = [worldFromView[12], worldFromView[13], worldFromView[14]];
    const yaw = C.viewYaw(worldFromView);
    const previous = state.motion.previous;
    if (previous) {
      const dt = Math.max(0.001, (time - previous.time) / 1000);
      state.motion.linear = C.len3(C.sub3(position, previous.position)) / dt;
      state.motion.angular = C.angleDiff(yaw, previous.yaw) / dt;
    } else {
      state.motion.linear = 0;
      state.motion.angular = 0;
    }
    state.motion.previous = { time, position, yaw };
    state.currentCamera = { position, yaw, pitch: C.viewPitch(worldFromView) };
  }

  function updateHitTest(frame) {
    state.hitPoint = null;
    if (!state.hitTestSource) return;
    try {
      const result = frame.getHitTestResults(state.hitTestSource)[0];
      const pose = result?.getPose(state.referenceSpace);
      if (pose) state.hitPoint = [pose.transform.position.x, pose.transform.position.y, pose.transform.position.z];
    } catch {
      // Hit testing is advisory; floor-ray geometry remains available.
    }
  }

  function updatePlaneSummary(frame) {
    const detected = frame.detectedPlanes;
    if (!detected || typeof detected[Symbol.iterator] !== 'function') return;
    let horizontal = 0;
    let vertical = 0;
    const ceilingCandidates = [];
    for (const plane of detected) {
      const orientation = plane.orientation || plane.planeOrientation || '';
      if (orientation === 'horizontal') horizontal += 1;
      else if (orientation === 'vertical') vertical += 1;
      const pose = frame.getPose?.(plane.planeSpace, state.referenceSpace);
      if (orientation === 'horizontal' && pose?.transform?.position?.y > CONFIG.minHeight) {
        ceilingCandidates.push(pose.transform.position.y);
      }
    }
    state.capabilities.planes = true;
    state.planeSummary = {
      horizontal,
      vertical,
      ceilingY: ceilingCandidates.length ? C.median(ceilingCandidates) : null,
    };
  }

  function updateAimSamples(time) {
    state.aimPoint = null;
    if (!state.currentProjection || !state.currentPoseMatrix) return;
    const ray = C.rayFromUV(state.currentProjection, state.currentPoseMatrix, 0.5, 0.52);
    const floorHit = C.rayPlaneY(ray, 0);
    if (!floorHit || floorHit.distance < 0.25 || floorHit.distance > 8.5) return;
    // Prefer an ARCore hit that is demonstrably on the local-floor plane. This
    // reduces aiming error near skirting boards, while the analytic floor ray
    // remains the deterministic fallback and never snaps to furniture.
    const hitOnFloor = state.hitPoint && Math.abs(state.hitPoint[1]) <= 0.16
      ? [state.hitPoint[0], 0, state.hitPoint[2]]
      : null;
    state.aimPoint = hitOnFloor || floorHit.point;
    if (state.phase === 'corners') {
      state.aimSamples.push({ time, point: floorHit.point });
      state.aimSamples = state.aimSamples.slice(-50);
    }
  }

  function updateHeightCandidate(time) {
    state.heightCandidate = null;
    if (state.phase !== 'height') return;
    const room = activeRoom();
    if (!room?.model || !state.currentProjection || !state.currentPoseMatrix) return;
    const ray = C.rayFromUV(state.currentProjection, state.currentPoseMatrix, 0.5, 0.50);
    let best = null;
    for (const wall of room.model.walls) {
      const hit = C.rayWallHit(ray, wall, room.model.floorY + 1.55, room.model.floorY + CONFIG.maxHeight);
      if (!hit) continue;
      if (!best || hit.distance < best.distance) best = hit;
    }
    if (best) {
      const height = best.point[1] - room.model.floorY;
      if (height >= CONFIG.minHeight && height <= CONFIG.maxHeight) {
        state.heightCandidate = { height, wallIndex: best.wallIndex, point: best.point, distance: best.distance };
        if (state.motion.linear < 0.2 && state.motion.angular < 0.55) {
          state.heightSamples.push({ time, value: height, wallIndex: best.wallIndex });
          state.heightSamples = state.heightSamples.slice(-40);
        }
      }
    } else if (Number.isFinite(state.planeSummary.ceilingY)) {
      const height = state.planeSummary.ceilingY - room.model.floorY;
      if (height >= CONFIG.minHeight && height <= CONFIG.maxHeight) {
        state.heightCandidate = { height, wallIndex: null, point: null, distance: null, source: 'plane' };
      }
    }
    if (state.heightCandidate && $('heightValue') && document.activeElement !== $('heightValue')) {
      $('heightValue').value = state.heightCandidate.height.toFixed(2);
    }
  }

  function updateTransitionPath(time) {
    if (state.phase !== 'transition' || !state.currentCamera) return;
    if (time - state.transition.lastPathTime < 120) return;
    state.transition.lastPathTime = time;
    const point = [state.currentCamera.position[0], state.currentCamera.position[2]];
    const path = state.transition.path;
    if (!path.length || C.len2(C.sub2(point, path[path.length - 1])) > 0.035) path.push(point);
    if (path.length > 240) path.shift();
    if (!state.transition.crossing) {
      const source = state.rooms.find(room => room.id === state.transition.sourceRoomId);
      state.transition.crossing = C.pathBoundaryCrossing(path, source?.model) || null;
      if (state.transition.crossing) log('PORTAL_CROSSING_DETECTED', 'INFO', state.transition.crossing);
    }
  }

  function processAnchorQueue(frame) {
    if (!state.anchorQueue.length || !frame.createAnchor || typeof XRRigidTransform === 'undefined') return;
    state.capabilities.anchors = true;
    const request = state.anchorQueue.shift();
    const transform = new XRRigidTransform({ x: request.point[0], y: request.point[1], z: request.point[2] });
    frame.createAnchor(transform, state.referenceSpace).then(anchor => {
      state.anchors.push(anchor);
      request.corner.anchorIndex = state.anchors.length - 1;
    }).catch(error => log('ANCHOR_CREATE_FAILED', 'WARN', { error: errorText(error) }));
  }

  function onXRFrame(time, frame) {
    const session = frame.session;
    if (session !== state.session) return;
    try {
      session.requestAnimationFrame(onXRFrame);
    } catch (error) {
      reportRuntimeError(error, 'XR_SCHEDULE');
      return;
    }
    try {
      const pose = frame.getViewerPose(state.referenceSpace);
      if (!pose) {
        state.trackingLost = true;
        updateHUD();
        renderOverlay();
        return;
      }
      state.trackingLost = false;
      state.frameCount += 1;
      state.lastFrameTime = time;
      clearXRLayer(pose);
      const view = findCameraView(pose);
      if (!view) return;
      state.currentView = view;
      state.currentPoseMatrix = [...view.transform.matrix];
      state.currentProjection = [...view.projectionMatrix];
      state.currentWorldToView = [...view.transform.inverse.matrix];
      updateMotion(time, state.currentPoseMatrix);
      recordMetricPose(time, state.currentPoseMatrix);
      updateHitTest(frame);
      updatePlaneSummary(frame);
      updateAimSamples(time);
      updateHeightCandidate(time);
      updateTransitionPath(time);
      processAnchorQueue(frame);
      if (state.phase === 'starting' || state.phase === 'starting-room') beginRoom();
      fuseLiveDepthFrame(frame, view, time);
      fulfillCaptureRequest(frame, view, time);
      autoCaptureTick(time);
      acousticSweepTick(time);
      if ($('screenTint')) {
        const flashing = state.audio.flashUntil > nowMs();
        $('screenTint').style.background = flashing ? 'rgba(120,221,255,.14)' : 'transparent';
      }
      renderOverlay();
      if (state.frameCount % 4 === 0) updateHUD();
    } catch (error) {
      // A recoverable rendering/UI exception must not tear down the metric
      // WebXR session. The next frame was already scheduled above.
      reportRuntimeError(error, 'XR_FRAME');
    }
  }

  async function settleCaptureBeforeExit() {
    const task = state.capturePromise;
    if (!task) return;
    let timeoutId = null;
    const result = await Promise.race([
      task.then(() => 'settled', () => 'settled'),
      new Promise(resolve => {
        timeoutId = setTimeout(() => resolve('timeout'), 1200);
      }),
    ]);
    if (timeoutId) clearTimeout(timeoutId);
    if (result !== 'timeout') return;
    // Tracking may be paused while Android animates browser navigation. Do not
    // keep an unfinished camera request alive while the XR session is ended.
    const request = state.captureRequest;
    if (request) {
      state.captureRequest = null;
      clearTimeout(request.timeoutId);
      try { request.reject(new Error('Scatto annullato dopo il salvataggio richiesto')); } catch {}
    }
    await task.catch(() => {});
  }

  async function saveAndCloseXR(reason = 'user-close') {
    if (state.navigationExitPending) return false;
    const endingSession = state.session;
    const previousPhase = state.phase;
    state.navigationExitPending = true;
    state.captureSuspended = true;
    state.audioController?.freezeScheduling?.();
    state.openReviewAfterEnd = true;
    cancelScheduledCheckpoint();
    updateHUD();
    await settleCaptureBeforeExit();
    const room = activeRoom();
    if (room && room.status !== 'complete') {
      room.status = room.model ? 'partial' : 'draft';
      if (room.model) {
        const stats = coverageStats(room);
        room.captureSummary = {
          ...stats.targets,
          frames: stats.frames,
          views: stats.views,
          completedWithUnresolvedTargets: stats.red + stats.yellow,
        };
      }
    }
    state.phase = state.rooms.length ? 'finished' : 'idle';
    state.normalEnding = true;
    updateHUD();
    if (!endingSession) {
      state.normalEnding = false;
      if (state.audioController && state.audio.prepared) {
        try {
          await state.audioController.stop({ flush: true, persist: true, maximumWaitMs: CONFIG.postXrAudioFlushMs });
          state.audio.manifests = state.audioController.measurements.map(record => state.audioController.measurementManifest(record));
          state.audio.prepared = false;
        } catch (error) {
          log('AUDIO_STOP_WITHOUT_XR_FAILED', 'WARN', { error: errorText(error) });
        }
      }
      state.navigationExitPending = false;
      state.captureSuspended = false;
      const saved = state.rooms.length ? await persistCheckpoint(reason) : false;
      state.postXrReady = true;
      state.handoffPending = false;
      updateProcessingAvailability();
      renderReview();
      updateLandingSummary();
      if (state.rooms.length) openReview();
      return saved || !state.rooms.length;
    }
    try {
      // Critical ordering contract: nothing that clones the scan, touches
      // IndexedDB, renders image thumbnails or starts ONNX may run before this.
      await endingSession.end();
      return true;
    } catch (error) {
      log('XR_SAFE_END_FAILED', 'ERROR', { reason, error: errorText(error) });
      if (state.session === endingSession) {
        state.normalEnding = false;
        state.navigationExitPending = false;
        state.captureSuspended = false;
        state.openReviewAfterEnd = false;
        state.phase = previousPhase;
        updateHUD();
        alert('Non sono riuscito a chiudere WebXR. I dati restano in memoria; riprova con “Salva e chiudi”.');
      }
      return false;
    }
  }

  async function interruptXR() {
    await saveAndCloseXR('close-button');
  }

  /* -----------------------------------------------------------------------
   * Room geometry workflow
   * -------------------------------------------------------------------- */

  function beginRoom() {
    const id = `R${++state.roomSequence}`;
    const room = {
      id,
      name: `Vano ${state.roomSequence}`,
      status: 'draft',
      footprint: [],
      corners: [],
      model: null,
      height: CONFIG.defaultHeight,
      coverage: C.coverageBins(CONFIG.coverageBins),
      photoTargets: [],
      captureSummary: null,
      viewClusters: [],
      frameIds: [],
      createdAt: nowIso(),
      completedAt: null,
    };
    state.rooms.push(room);
    state.activeRoomId = id;
    state.phase = 'corners';
    state.aimSamples = [];
    state.heightSamples = [];
    state.heightCandidate = null;
    updateHUD();
    renderPlan();
    log('ROOM_STARTED', 'INFO', { roomId: id });
    scheduleCheckpoint('room-start');
  }

  function addCorner() {
    const room = activeRoom();
    if (!room || state.phase !== 'corners') return;
    const stable = C.stablePoint(state.aimSamples);
    const source = stable?.point || state.aimPoint;
    if (!source) {
      alert('Inclina il telefono verso il punto in cui parete e pavimento si incontrano.');
      return;
    }
    const raw = [source[0], source[2]];
    // V20 never interprets proximity to the first point as an implicit close:
    // narrow recesses and very short return walls are legitimate geometry.
    // The footprint is closed only by the explicit “Chiudi vano” action.
    const snapped = C.snapFloorCorner(raw, room.footprint, { orthogonal: $('smartSnap')?.checked !== false });
    const point = snapped.point;
    if (room.footprint.length && C.len2(C.sub2(point, room.footprint[room.footprint.length - 1])) < CONFIG.numericalCornerEpsilon) {
      alert('Il punto coincide con l angolo precedente. Mira a un punto geometricamente distinto.');
      return;
    }
    if (room.footprint.length >= 2) {
      const a = room.footprint[room.footprint.length - 1];
      for (let index = 0; index < room.footprint.length - 2; index += 1) {
        const crossing = C.segmentIntersection(a, point, room.footprint[index], room.footprint[index + 1], false);
        if (crossing) {
          alert('Il nuovo lato incrocerebbe il perimetro. Annulla o mira a un angolo diverso.');
          return;
        }
      }
    }
    const corner = {
      point: [...point],
      raw: [...raw],
      jitter: stable?.jitter ?? null,
      stable: Boolean(stable?.stable),
      snapped: snapped.snapped,
      capturedAt: nowIso(),
      anchorIndex: null,
    };
    room.footprint.push(point);
    room.corners.push(corner);
    state.anchorQueue.push({ point: [point[0], 0, point[1]], corner });
    state.aimSamples = [];
    log('CORNER_ADDED', 'INFO', { roomId: room.id, point, jitter: corner.jitter, snapped: corner.snapped });
    updateHUD();
    scheduleCheckpoint('corner-added');
  }

  function undoCorner() {
    const room = activeRoom();
    if (!room || state.phase !== 'corners' || !room.footprint.length) return;
    room.footprint.pop();
    room.corners.pop();
    state.aimSamples = [];
    updateHUD();
    scheduleCheckpoint('corner-undone');
  }

  function closeRoom() {
    const room = activeRoom();
    if (!room || state.phase !== 'corners') return;
    const validation = C.validateFootprint(room.footprint, { minEdge: CONFIG.numericalCornerEpsilon, minArea: CONFIG.numericalAreaEpsilon });
    if (!validation.ok) {
      alert(validation.reason);
      return;
    }
    try {
      room.model = C.buildRoomModel(room.footprint, 0, CONFIG.defaultHeight);
      room.height = CONFIG.defaultHeight;
      room.status = 'height';
      state.phase = 'height';
      state.heightSamples = [];
      state.heightCandidate = null;
      if (state.pendingPortalId) {
        const portal = state.portals.find(item => item.id === state.pendingPortalId);
        const result = C.linkPortalToRoom(portal, state.rooms, room);
        if (result.ok) log('PORTAL_LINKED', 'INFO', { portalId: portal.id, roomId: room.id, score: result.score });
        else log('PORTAL_LINK_WEAK', 'WARN', { portalId: portal?.id, reason: result.reason });
        state.pendingPortalId = null;
      }
      log('ROOM_FOOTPRINT_CLOSED', 'INFO', { roomId: room.id, area: room.model.area });
      lockActions(550);
      updateHUD();
      renderPlan();
      scheduleCheckpoint('footprint-closed');
    } catch (error) {
      alert(errorText(error));
    }
  }

  function robustHeightFromSamples() {
    const recent = state.heightSamples.slice(-24).map(sample => sample.value);
    if (recent.length < 4) return state.heightCandidate?.height ?? null;
    const center = C.median(recent);
    const deviation = C.mad(recent, center);
    return deviation <= 0.10 ? center : state.heightCandidate?.height ?? center;
  }

  function confirmHeight(useDefault = false) {
    const room = activeRoom();
    if (!room?.model || state.phase !== 'height') return;
    const inputValue = Number($('heightValue')?.value);
    const measured = robustHeightFromSamples();
    const height = useDefault
      ? CONFIG.defaultHeight
      : C.clamp(Number.isFinite(inputValue) ? inputValue : measured, CONFIG.minHeight, CONFIG.maxHeight);
    if (!Number.isFinite(height)) {
      alert('Mira al raccordo parete-soffitto oppure inserisci una altezza manuale.');
      return;
    }
    room.height = height;
    C.updateRoomHeight(room.model, height);
    room.photoTargets = C.createWallPhotoTargets(room.model, {
      desiredWidth: CONFIG.photoTargetWidth,
      maxColumns: CONFIG.photoTargetMaxColumns,
      objectRequiredViews: CONFIG.photoTargetObjectViews,
      surfaceRequiredViews: CONFIG.photoTargetSurfaceViews,
    }).map(target => ({ ...target, id: `${room.id}-${target.id}` }));
    room.status = 'coverage';
    state.phase = 'coverage';
    state.lastCaptureTime = 0;
    refreshAcousticSurfaces();
    log('ROOM_HEIGHT_SET', 'INFO', { roomId: room.id, height });
    lockActions(550);
    updateHUD();
    scheduleCheckpoint('height-confirmed');
  }

  function ensureRoomPhotoTargets(room) {
    if (!room?.model) return [];
    if (!Array.isArray(room.photoTargets) || !room.photoTargets.length) {
      room.photoTargets = C.createWallPhotoTargets(room.model, {
        desiredWidth: CONFIG.photoTargetWidth,
        maxColumns: CONFIG.photoTargetMaxColumns,
        objectRequiredViews: CONFIG.photoTargetObjectViews,
        surfaceRequiredViews: CONFIG.photoTargetSurfaceViews,
      }).map(target => ({ ...target, id: `${room.id}-${target.id}` }));
    }
    for (const target of room.photoTargets) {
      if (!Array.isArray(target.observations)) target.observations = [];
      target.status = C.photoTargetStatus(target);
    }
    return room.photoTargets;
  }

  function currentViewCluster() {
    return state.currentPoseMatrix
      ? C.viewClusterId(state.currentPoseMatrix, CONFIG.viewClusterSize)
      : null;
  }

  function evaluateTargetNow(target) {
    const worldToView = state.currentWorldToView
      || (state.currentPoseMatrix ? C.invert4(state.currentPoseMatrix) : null);
    return C.evaluatePhotoTarget(
      target,
      state.currentProjection,
      worldToView,
      state.currentCamera?.position,
      { minimumScore: CONFIG.photoTargetMinScore },
    );
  }

  function targetRelativeDirection(target) {
    if (!target?.center || !state.currentCamera) return 0;
    const dx = target.center[0] - state.currentCamera.position[0];
    const dz = target.center[2] - state.currentCamera.position[2];
    return relativeDirectionToYaw(Math.atan2(dz, dx));
  }

  function targetObservedFromCluster(target, cluster) {
    if (!cluster) return false;
    return (target?.observations || []).some(observation => observation.viewCluster === cluster);
  }

  function coverageStats(room) {
    const frames = roomFrames(room.id);
    const views = new Set(frames.map(frame => frame.viewCluster));
    const targets = C.photoTargetStats(ensureRoomPhotoTargets(room));
    const frameScore = C.clamp(frames.length / CONFIG.coverageTargetFrames);
    const viewScore = C.clamp(views.size / CONFIG.coverageTargetViews);
    const score = C.clamp(0.72 * targets.progress + 0.13 * frameScore + 0.15 * viewScore);
    return {
      frames: frames.length,
      views: views.size,
      angular: targets.progress,
      score,
      targets,
      red: targets.red,
      yellow: targets.yellow,
      green: targets.green,
      total: targets.total,
    };
  }

  function roomCompletionReadiness(room) {
    const stats = coverageStats(room);
    const missing = [];
    if (stats.frames < CONFIG.coverageMinimumFrames) {
      missing.push(`${CONFIG.coverageMinimumFrames - stats.frames} foto`);
    }
    if (stats.views < CONFIG.coverageMinimumViews) {
      missing.push(`${CONFIG.coverageMinimumViews - stats.views} posizione`);
    }
    // Wall tiles are guidance, never an unescapable lock. Once the minimum
    // multi-view evidence exists, the user may complete the room even if an
    // occluded tile remains red or a lower object tile remains yellow.
    return {
      ...stats,
      ready: missing.length === 0,
      coverageComplete: stats.red === 0 && stats.yellow === 0,
      unresolved: stats.red + stats.yellow,
      missing,
    };
  }

  function planarViewBasis() {
    const yaw = state.currentCamera?.yaw ?? 0;
    const forward = [Math.cos(yaw), Math.sin(yaw)];
    let right = state.currentPoseMatrix
      ? [state.currentPoseMatrix[0], state.currentPoseMatrix[2]]
      : [-Math.sin(yaw), Math.cos(yaw)];
    const length = Math.hypot(right[0], right[1]);
    if (length > 1e-6) right = [right[0] / length, right[1] / length];
    else right = [-Math.sin(yaw), Math.cos(yaw)];
    return { yaw, forward, right };
  }

  function relativeDirectionToYaw(targetYaw) {
    const basis = planarViewBasis();
    const direction = [Math.cos(targetYaw), Math.sin(targetYaw)];
    const forwardAmount = direction[0] * basis.forward[0] + direction[1] * basis.forward[1];
    const rightAmount = direction[0] * basis.right[0] + direction[1] * basis.right[1];
    return Math.atan2(rightAmount, forwardAmount);
  }

  function choosePhotoTarget(room) {
    const cluster = currentViewCluster();
    const candidates = ensureRoomPhotoTargets(room)
      .map(target => {
        const status = C.photoTargetStatus(target);
        if (status === 'green') return null;
        const evaluation = evaluateTargetNow(target);
        const sameCluster = targetObservedFromCluster(target, cluster);
        const relative = targetRelativeDirection(target);
        let rank = 30;
        if (evaluation.good && !sameCluster) rank = 0;
        else if (evaluation.visible && !sameCluster) rank = 8;
        else if (!sameCluster) rank = 16;
        else rank = 24;
        if (status === 'red') rank -= 2;
        rank += Math.min(5, Math.abs(relative));
        return { target, status, evaluation, sameCluster, relative, rank };
      })
      .filter(Boolean)
      .sort((a, b) => a.rank - b.rank || a.target.wallIndex - b.target.wallIndex || a.target.row - b.target.row);
    return candidates[0] || null;
  }

  function coverageGuidance(room) {
    const stats = room?.model
      ? coverageStats(room)
      : { frames: 0, views: 0, score: 0, red: 0, yellow: 0, green: 0, total: 0 };
    const selected = room?.model ? choosePhotoTarget(room) : null;
    const target = selected?.target || null;
    const evaluation = selected?.evaluation || null;
    const stable = state.motion.linear <= CONFIG.stableLinearSpeed
      && state.motion.angular <= CONFIG.stableAngularSpeed;
    const relative = selected?.relative || 0;
    const angle = Math.round(Math.abs(degrees(relative)) / 5) * 5;
    let turn = 'center';
    if (evaluation?.center) {
      const dx = evaluation.center.u - 0.5;
      const dy = evaluation.center.v - 0.5;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 0.09) turn = dx > 0 ? 'right' : 'left';
      else if (Math.abs(dy) > 0.09) turn = dy > 0 ? 'down' : 'up';
    } else if (target && Math.abs(relative) > 0.12) {
      turn = relative > 0 ? 'right' : 'left';
    }
    const aligned = Boolean(evaluation?.good);
    const needsNewView = Boolean(target && selected?.sameCluster && selected.status === 'yellow');
    let instruction = 'Tutte le caselle sono verdi';
    let detail = 'Puoi completare il vano o aggiungere una foto manuale.';

    if (state.completionPending) {
      instruction = 'Salvo l ultima foto e completo il vano';
      detail = 'La sessione resta attiva fino alla fine del salvataggio.';
    } else if (!stable) {
      instruction = 'Tieni fermo il telefono';
      detail = 'Le caselle restano ancorate alle pareti; lo scatto parte quando il movimento si stabilizza.';
    } else if (needsNewView) {
      instruction = 'Spostati lateralmente di circa mezzo metro';
      detail = 'La casella gialla ha gia una foto: serve una seconda posizione per gli oggetti.';
    } else if (target && evaluation?.good) {
      instruction = selected.status === 'yellow' ? 'Seconda foto di questa casella' : 'Fotografa questa casella';
      detail = 'Mantienila al centro: lo scatto automatico parte da solo.';
    } else if (target && evaluation?.visible) {
      instruction = `Porta la casella ${selected.status === 'red' ? 'rossa' : 'gialla'} al centro`;
      detail = turn === 'up' ? 'Inclina leggermente verso l alto.'
        : turn === 'down' ? 'Inclina leggermente verso il basso.'
          : `Segui la freccia verso ${turn === 'right' ? 'destra' : 'sinistra'}.`;
    } else if (target) {
      instruction = `Ruota ${angle || 5} gradi a ${turn === 'right' ? 'destra' : 'sinistra'}`;
      detail = 'La freccia indica la prossima area fisica della parete da inquadrare.';
    }

    return {
      ...stats,
      target,
      targetStatus: selected?.status || null,
      evaluation,
      remaining: stats.red + stats.yellow,
      aligned,
      stable,
      needsNewView,
      sameCluster: selected?.sameCluster || false,
      relative,
      turn,
      angle,
      instruction,
      detail,
    };
  }

  function completeRoom() {
    const room = activeRoom();
    if (!room?.model || state.phase !== 'coverage') return false;
    const readiness = roomCompletionReadiness(room);
    if (!readiness.ready) {
      alert(`Prima di completare servono ancora: ${readiness.missing.join(' e ')}. Le caselle colorate restano una guida, non bloccano il vano.`);
      return false;
    }
    // Completing while readPixels/JPEG conversion is still active creates a
    // phase race on mobile. Queue the transition and let captureKeyframe's
    // finally block perform it only after all transient buffers are released.
    if (state.captureBusy || state.captureRequest) {
      state.completionPending = true;
      updateHUD();
      return false;
    }
    state.completionPending = false;
    room.status = 'complete';
    room.completedAt = nowIso();
    room.captureSummary = {
      ...readiness.targets,
      frames: readiness.frames,
      views: readiness.views,
      completedWithUnresolvedTargets: readiness.unresolved,
    };
    state.phase = 'room-ready';
    state.finishArmUntil = 0;
    lockActions();
    log('ROOM_COMPLETED', 'INFO', { roomId: room.id, ...readiness });
    updateHUD();
    renderPlan();
    scheduleCheckpoint('room-completed', 80);
    return true;
  }

  function beginTransition() {
    const room = activeRoom();
    if (!room?.model || state.phase !== 'room-ready') return;
    state.finishArmUntil = 0;
    state.phase = 'transition';
    state.transition = {
      sourceRoomId: room.id,
      path: state.currentCamera ? [[state.currentCamera.position[0], state.currentCamera.position[2]]] : [],
      crossing: null,
      lastPathTime: 0,
    };
    lockActions(700);
    updateHUD();
    scheduleCheckpoint('transition-started');
  }

  function cancelTransition() {
    if (state.phase !== 'transition') return;
    state.phase = 'room-ready';
    state.transition = { sourceRoomId: null, path: [], crossing: null, lastPathTime: 0 };
    lockActions(650);
    updateHUD();
    scheduleCheckpoint('transition-cancelled');
  }

  function finishTransition() {
    if (state.phase !== 'transition') return;
    const source = state.rooms.find(room => room.id === state.transition.sourceRoomId);
    if (!source?.model) return;
    let crossing = state.transition.crossing;
    if (!crossing && state.currentCamera) {
      const point = [state.currentCamera.position[0], state.currentCamera.position[2]];
      const nearest = C.nearestWallPoint(point, source.model);
      if (nearest) {
        crossing = {
          point: nearest.point,
          wallIndex: nearest.wallIndex,
          wallT: nearest.t,
          kind: 'nearest',
          direction: [0, 0],
        };
      }
    }
    if (!crossing) {
      alert('Non riesco a individuare la parete attraversata. Torna vicino alla porta e riprova.');
      return;
    }
    const portal = C.createPortalFromCrossing(source, crossing, CONFIG.defaultPortalWidth, CONFIG.defaultPortalTop);
    if (!portal) {
      alert('Passaggio non creabile su questa parete.');
      return;
    }
    portal.id = `P${++state.portalSequence}`;
    state.portals.push(portal);
    state.pendingPortalId = portal.id;
    log('PORTAL_CREATED', 'INFO', { portalId: portal.id, roomId: source.id, wallIndex: crossing.wallIndex, confidence: portal.confidence });
    state.transition = { sourceRoomId: null, path: [], crossing: null, lastPathTime: 0 };
    beginRoom();
    lockActions(700);
    scheduleCheckpoint('portal-created');
  }

  async function finishAcquisition() {
    if (!state.session) return;
    if (state.phase === 'coverage') completeRoom();
    if (state.phase !== 'room-ready') {
      alert('Completa il vano corrente e attendi almeno tre fotografie da due posizioni prima di terminare la scansione.');
      return;
    }
    await saveAndCloseXR('finish-scan');
  }

  /* -----------------------------------------------------------------------
   * Synchronized keyframes and sparse XR object evidence
   * -------------------------------------------------------------------- */

  function fulfillCaptureRequest(frame, view, time) {
    const request = state.captureRequest;
    if (!request) return;
    state.captureRequest = null;
    clearTimeout(request.timeoutId);
    try {
      const camera = readCameraRGBA(view, request.longEdge || CONFIG.captureLongEdge);
      if (!camera) throw new Error('Raw camera XR non disponibile nel frame corrente');
      const depthGrid = sampleDepthGrid(frame, view);
      if (depthGrid?.coverage > 0) state.capabilities.depth = true;
      request.resolve({
        time,
        rgba: camera.rgba,
        width: camera.width,
        height: camera.height,
        projection: [...view.projectionMatrix],
        worldFromView: [...view.transform.matrix],
        worldToView: [...view.transform.inverse.matrix],
        depthGrid,
      });
    } catch (error) {
      request.reject(error);
    }
  }

  function captureKeyframe(role = 'survey', mode = 'manual') {
    if (state.captureSuspended || !state.session || state.captureRequest || state.captureBusy) return Promise.resolve(null);
    const room = activeRoom();
    if (!room?.model) return Promise.resolve(null);
    if (state.frames.length >= CONFIG.maxFramesTotal) {
      log('FRAME_LIMIT_REACHED', 'WARN');
      return Promise.resolve(null);
    }
    if (roomFrames(room.id).length >= CONFIG.maxFramesPerRoom) return Promise.resolve(null);
    state.captureBusy = true;
    const promise = new Promise((resolve, reject) => {
      const request = { resolve, reject, role, mode, roomId: room.id, longEdge: CONFIG.captureLongEdge, timeoutId: null };
      request.timeoutId = setTimeout(() => {
        if (state.captureRequest !== request) return;
        state.captureRequest = null;
        reject(new Error('Timeout scatto XR: tracking o camera non disponibili'));
      }, CONFIG.captureTimeoutMs);
      state.captureRequest = request;
    });
    const task = promise.then(snapshot => finalizeKeyframe(snapshot, room, role, mode)).catch(error => {
      log('CAPTURE_FAILED', 'WARN', { error: errorText(error) });
      return null;
    }).finally(() => {
      state.captureBusy = false;
      state.capturePromise = null;
      const completeAfterCapture = state.completionPending && state.phase === 'coverage';
      if (completeAfterCapture) {
        state.completionPending = false;
        // Defer one task so the Promise chain and its camera buffers become
        // collectible before changing the room workflow state.
        setTimeout(() => completeRoom(), 0);
      } else {
        updateHUD();
      }
    });
    state.capturePromise = task;
    return task;
  }

  function estimateWallVisibility(frame, room) {
    const visibility = {};
    for (const wall of room.model.walls) {
      const points = [
        [wall.a[0], room.model.floorY + 0.15, wall.a[1]],
        [wall.b[0], room.model.floorY + 0.15, wall.b[1]],
        [wall.b[0], room.model.ceilingY - 0.15, wall.b[1]],
        [wall.a[0], room.model.ceilingY - 0.15, wall.a[1]],
        [(wall.a[0] + wall.b[0]) / 2, room.model.floorY + room.model.height / 2, (wall.a[1] + wall.b[1]) / 2],
      ].map(point => C.projectPoint(frame.projection, frame.worldToView, point)).filter(Boolean);
      const inside = points.filter(point => point.u > -0.08 && point.u < 1.08 && point.v > -0.08 && point.v < 1.08);
      visibility[wall.index] = inside.length / points.length;
    }
    return visibility;
  }

  async function finalizeKeyframe(snapshot, room, role, mode) {
    const quality = imageQuality(snapshot.rgba, snapshot.width, snapshot.height);
    const jpegDataUrl = rgbaToJpeg(snapshot.rgba, snapshot.width, snapshot.height);
    const yaw = C.viewYaw(snapshot.worldFromView);
    const viewCluster = C.viewClusterId(snapshot.worldFromView, CONFIG.viewClusterSize);
    const frame = {
      id: ++state.frameSequence,
      roomId: room.id,
      role,
      captureMode: mode,
      createdAt: nowIso(),
      time: snapshot.time,
      quality,
      status: 'captured',
      jpegDataUrl,
      rgba: snapshot.rgba,
      rgbWidth: snapshot.width,
      rgbHeight: snapshot.height,
      projection: snapshot.projection,
      worldFromView: snapshot.worldFromView,
      worldToView: snapshot.worldToView,
      depthGrid: snapshot.depthGrid,
      yaw,
      pitch: C.viewPitch(snapshot.worldFromView),
      viewCluster,
      wallVisibility: null,
      deep: null,
      depthFit: null,
      deepMask: null,
      deepClass: null,
    };
    frame.wallVisibility = estimateWallVisibility(frame, room);
    state.frames.push(frame);
    room.frameIds.push(frame.id);
    if (!room.viewClusters.includes(viewCluster)) room.viewClusters.push(viewCluster);
    // Legacy yaw bins remain populated only so older diagnostic/export tools
    // can still read the RAW. The live coach uses physical wall targets.
    C.markAngularCoverage(room.coverage, yaw, C.horizontalFov(frame.projection), quality);
    const targetUpdate = C.registerFramePhotoTargets(ensureRoomPhotoTargets(room), frame, {
      minimumScore: CONFIG.photoTargetMinScore,
    });
    frame.photoTargetUpdate = targetUpdate;
    if (frame.depthGrid?.coverage > 0) {
      const surfelUpdate = state.surfelMap.addDepthFrame({
        id: frame.id,
        projection: frame.projection,
        poseMatrix: frame.worldFromView,
        depthValues: frame.depthGrid.data,
        depthWidth: frame.depthGrid.width,
        depthHeight: frame.depthGrid.height,
        rgba: frame.rgba,
        width: frame.rgbWidth,
        height: frame.rgbHeight,
      }, {
        source: 'xr-depth-rgb-keyframe',
        weight: 1.35,
        viewId: frame.viewCluster,
        roomId: room.id,
        rooms: state.rooms,
        stride: 1,
        minimumDepth: CONFIG.minDepth,
        maximumDepth: CONFIG.maxDepth,
      });
      frame.surfelUpdate = surfelUpdate;
    }
    classifyXRFrameObjects(frame, room);
    frame.rgba = null;
    state.lastCaptureTime = snapshot.time;
    log('KEYFRAME_CAPTURED', 'INFO', {
      frameId: frame.id,
      roomId: room.id,
      quality: Number(quality.toFixed(2)),
      viewCluster,
      xrDepth: snapshot.depthGrid?.coverage || 0,
      targetObserved: frame.photoTargetUpdate?.observed || 0,
      targetGreened: frame.photoTargetUpdate?.greened || 0,
    });
    updateHUD();
    scheduleCheckpoint('keyframe-captured', 90);
    return frame;
  }

  function classifyXRFrameObjects(frame, room) {
    const grid = frame.depthGrid;
    if (!grid || !frame.rgba || !room?.model) return { objects: 0, structural: 0 };
    let objects = 0;
    let structural = 0;
    const cameraPosition = [frame.worldFromView[12], frame.worldFromView[13], frame.worldFromView[14]];
    for (let y = 0; y < grid.height; y += 1) {
      for (let x = 0; x < grid.width; x += 1) {
        const depthZ = grid.data[y * grid.width + x];
        if (!(depthZ > 0)) continue;
        const u = (x + 0.5) / grid.width;
        const v = (y + 0.5) / grid.height;
        const ray = C.rayFromUV(frame.projection, frame.worldFromView, u, v);
        const shell = C.rayRoomHit(ray, room.model);
        const worldPoint = C.worldFromViewDepth(frame.projection, frame.worldFromView, u, v, depthZ);
        if (!ray || !shell || !worldPoint) continue;
        const observedDistance = C.len3(C.sub3(worldPoint, cameraPosition));
        const tolerance = Math.max(CONFIG.xrToleranceMin, 0.045 * shell.distance);
        if (shell.distance - observedDistance > tolerance
            && worldPoint[1] > room.model.floorY + 0.08
            && worldPoint[1] < room.model.ceilingY - 0.06
            && C.pointInPolygon([worldPoint[0], worldPoint[2]], room.model.footprint)) {
          C.mergeVoxel(state.objectVoxels, worldPoint, {
            source: 'XR',
            viewId: frame.viewCluster,
            frameId: frame.id,
            roomId: room.id,
            color: colorAt(frame, u, v),
            weight: 1.2,
          }, CONFIG.objectVoxelSize);
          objects += 1;
        } else if (Math.abs(shell.distance - observedDistance) <= tolerance) {
          structural += 1;
        }
      }
    }
    pruneObjectVoxels();
    return { objects, structural };
  }

  function pruneObjectVoxels() {
    if (state.objectVoxels.size <= CONFIG.objectMaxVoxels) return;
    const entries = [...state.objectVoxels.entries()].sort((a, b) => {
      const scoreA = a[1].viewIds.size + 0.5 * a[1].xrCount + 0.3 * a[1].deepCount;
      const scoreB = b[1].viewIds.size + 0.5 * b[1].xrCount + 0.3 * b[1].deepCount;
      return scoreB - scoreA;
    }).slice(0, CONFIG.objectMaxVoxels);
    state.objectVoxels = new Map(entries);
  }

  function autoCaptureTick(time) {
    if (state.captureSuspended || state.phase !== 'coverage' || state.captureRequest || state.captureBusy) return;
    const room = activeRoom();
    if (!room?.model || !state.currentPoseMatrix || state.trackingLost) return;
    const frames = roomFrames(room.id);
    if (frames.length >= CONFIG.maxFramesPerRoom) return;
    if (time - state.lastCaptureTime < CONFIG.captureGapMs) return;
    if (state.motion.linear > CONFIG.stableLinearSpeed || state.motion.angular > CONFIG.stableAngularSpeed) return;
    const guide = coverageGuidance(room);
    if (!guide.target || !guide.evaluation?.good || guide.needsNewView) return;
    const cluster = currentViewCluster();
    if (targetObservedFromCluster(guide.target, cluster)) return;
    captureKeyframe('survey', 'auto').catch(() => {});
  }

  /* -----------------------------------------------------------------------
   * Batch Depth Anything processing
   * -------------------------------------------------------------------- */

  function qualityProfile() {
    const requested = $('quality')?.value || 'balanced';
    if (requested === 'accurate' || requested === 'high') {
      return { id: 'accurate', input: 392, resizeLong: 720, maxFrames: 11, texturePpm: 52, textureMaxWidth: 620, textureMaxHeight: 360 };
    }
    if (requested === 'quick' || requested === 'fast') {
      return { id: 'quick', input: 280, resizeLong: 440, maxFrames: 6, texturePpm: 30, textureMaxWidth: 360, textureMaxHeight: 230 };
    }
    return { id: 'balanced', input: 336, resizeLong: 560, maxFrames: 8, texturePpm: 40, textureMaxWidth: 480, textureMaxHeight: 300 };
  }

  function workerRequest(worker, type, payload = {}, transfer = []) {
    if (!worker || worker !== state.worker) return Promise.reject(new Error('Worker Deep non attivo'));
    const id = `v20-${++state.workerSequence}`;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        state.workerPending.delete(id);
        reject(new Error(`Timeout worker: ${type}`));
      }, type === 'init' ? 180000 : 120000);
      state.workerPending.set(id, { resolve, reject, timeout, worker });
      try {
        worker.postMessage({ id, type, ...payload }, transfer);
      } catch (error) {
        clearTimeout(timeout);
        state.workerPending.delete(id);
        reject(error);
      }
    });
  }

  function destroyDepthWorker(reason = 'Worker Deep chiuso') {
    const worker = state.worker;
    if (!worker) return;
    try { worker.terminate(); } catch {}
    for (const [id, pending] of state.workerPending) {
      if (pending.worker !== worker) continue;
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
      state.workerPending.delete(id);
    }
    state.worker = null;
    state.depthReady = false;
    state.workerEpoch += 1;
  }

  async function bootDepthWorker(inputSize) {
    const worker = new Worker(`./depth_ai_worker_v20_1_0.js?build=${REVISION}`);
    const epoch = ++state.workerEpoch;
    state.worker = worker;
    state.depthInputSize = inputSize;
    worker.onmessage = event => {
      if (worker !== state.worker || epoch !== state.workerEpoch) return;
      const message = event.data || {};
      if (message.type === 'progress') {
        updateProcessUI(`Deep: ${message.detail || message.stage || 'caricamento'}`, 0.03 + 0.62 * state.process.done / Math.max(1, state.process.total));
        return;
      }
      const pending = state.workerPending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      state.workerPending.delete(message.id);
      if (message.ok) pending.resolve(message);
      else pending.reject(new Error(message.error || 'Errore worker Deep'));
    };
    worker.onerror = event => destroyDepthWorker(event.message || 'Crash worker Deep');
    const init = await workerRequest(worker, 'init', {
      runtimeVersion: '1.23.2',
      inputSize,
      runtimeLocal: './vendor/onnxruntime-web/ort.min.js',
      runtimeRemote: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort.min.js',
      modelLocal: './models/depth_anything_v2_small_q4.onnx',
      modelRemoteUrls: [
        'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_q4.onnx',
        'https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_uint8.onnx',
      ],
    });
    const smoke = await workerRequest(worker, 'smoke');
    if (!(smoke.outputWidth > 0 && smoke.outputHeight > 0)) throw new Error('Smoke test Deep senza output');
    state.depthReady = true;
    return { init, smoke };
  }

  function ensureDepthWorker(inputSize) {
    if (state.depthReady && state.worker && state.depthInputSize === inputSize) return Promise.resolve();
    if (state.depthBootPromise) return state.depthBootPromise;
    if (state.worker) destroyDepthWorker('Cambio profilo Deep');
    state.depthBootPromise = bootDepthWorker(inputSize).finally(() => {
      state.depthBootPromise = null;
    });
    return state.depthBootPromise;
  }

  function resizeRGBA(source, width, height, longEdge) {
    const scale = Math.min(1, longEdge / Math.max(width, height));
    const outputWidth = Math.max(2, Math.round(width * scale));
    const outputHeight = Math.max(2, Math.round(height * scale));
    if (outputWidth === width && outputHeight === height) return { rgba: source, width, height };
    const inputCanvas = document.createElement('canvas');
    inputCanvas.width = width;
    inputCanvas.height = height;
    inputCanvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(source), width, height), 0, 0);
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = outputWidth;
    outputCanvas.height = outputHeight;
    const context = outputCanvas.getContext('2d');
    context.drawImage(inputCanvas, 0, 0, outputWidth, outputHeight);
    const rgba = new Uint8ClampedArray(context.getImageData(0, 0, outputWidth, outputHeight).data);
    inputCanvas.width = 1;
    inputCanvas.height = 1;
    outputCanvas.width = 1;
    outputCanvas.height = 1;
    return { rgba, width: outputWidth, height: outputHeight };
  }

  async function inferDepth(frame, profile) {
    await ensureFrameRGBA(frame);
    await ensureDepthWorker(profile.input);
    const resized = resizeRGBA(frame.rgba, frame.rgbWidth, frame.rgbHeight, profile.resizeLong);
    const transferable = new Uint8ClampedArray(resized.rgba);
    const result = await workerRequest(state.worker, 'infer', {
      width: resized.width,
      height: resized.height,
      rgba: transferable.buffer,
    }, [transferable.buffer]);
    frame.deep = {
      data: new Float32Array(result.depth),
      width: result.outputWidth,
      height: result.outputHeight,
      inferenceMs: result.inferenceMs,
    };
    return frame.deep;
  }

  function deepAt(frame, u, v) {
    if (!frame.deep) return NaN;
    const x = C.clamp(Math.floor(u * frame.deep.width), 0, frame.deep.width - 1);
    const y = C.clamp(Math.floor(v * frame.deep.height), 0, frame.deep.height - 1);
    return frame.deep.data[y * frame.deep.width + x];
  }

  function fitSamplesForFrame(frame, room) {
    const samples = [];
    const gridX = 30;
    const gridY = 20;
    for (let y = 0; y < gridY; y += 1) {
      for (let x = 0; x < gridX; x += 1) {
        const u = (x + 0.5) / gridX;
        const v = (y + 0.5) / gridY;
        const relative = deepAt(frame, u, v);
        if (!Number.isFinite(relative)) continue;
        const xrDepth = depthGridAt(frame.depthGrid, u, v);
        if (xrDepth && xrDepth >= CONFIG.minDepth && xrDepth <= CONFIG.maxDepth) {
          samples.push({ relative, metric: xrDepth, weight: 4.0, source: 'xr' });
        }
        const ray = C.rayFromUV(frame.projection, frame.worldFromView, u, v);
        const shell = C.rayRoomHit(ray, room.model);
        if (!shell) continue;
        const projected = C.projectPoint(frame.projection, frame.worldToView, shell.point);
        if (!projected || projected.depthZ < CONFIG.minDepth || projected.depthZ > CONFIG.maxDepth) continue;
        const edge = Math.min(u, 1 - u, v, 1 - v);
        const upperWeight = v < 0.55 ? 1.35 : 0.75;
        const edgeWeight = edge < 0.18 ? 1.25 : 0.85;
        samples.push({ relative, metric: projected.depthZ, weight: upperWeight * edgeWeight, source: 'shell' });
      }
    }
    return samples;
  }

  function classifyDeepFrame(frame, room) {
    const samples = fitSamplesForFrame(frame, room);
    const fit = C.fitRelativeDepth(samples);
    frame.depthFit = fit;
    if (!fit || fit.count < 10 || fit.p90Error > 0.75) {
      throw new Error('Scala Deep non affidabile per questo keyframe');
    }
    const mask = new Uint8Array(CONFIG.deepGridX * CONFIG.deepGridY);
    const cameraPosition = [frame.worldFromView[12], frame.worldFromView[13], frame.worldFromView[14]];
    let structural = 0;
    let objects = 0;
    let optical = 0;
    let unknown = 0;
    for (let y = 0; y < CONFIG.deepGridY; y += 1) {
      for (let x = 0; x < CONFIG.deepGridX; x += 1) {
        const u = (x + 0.5) / CONFIG.deepGridX;
        const v = (y + 0.5) / CONFIG.deepGridY;
        const relative = deepAt(frame, u, v);
        const metricZ = C.metricDepth(fit, relative);
        const index = y * CONFIG.deepGridX + x;
        if (!(metricZ >= CONFIG.minDepth && metricZ <= CONFIG.maxDepth)) {
          unknown += 1;
          continue;
        }
        const ray = C.rayFromUV(frame.projection, frame.worldFromView, u, v);
        const shell = C.rayRoomHit(ray, room.model);
        const worldPoint = C.worldFromViewDepth(frame.projection, frame.worldFromView, u, v, metricZ);
        if (!ray || !shell || !worldPoint) {
          unknown += 1;
          continue;
        }
        const observedDistance = C.len3(C.sub3(worldPoint, cameraPosition));
        const tolerance = Math.max(CONFIG.deepToleranceMin, CONFIG.deepToleranceFraction * shell.distance, 2.2 * fit.medianError);
        if (shell.distance - observedDistance > tolerance
            && worldPoint[1] > room.model.floorY + 0.08
            && worldPoint[1] < room.model.ceilingY - 0.06
            && C.pointInPolygon([worldPoint[0], worldPoint[2]], room.model.footprint)) {
          mask[index] = 2;
          C.mergeVoxel(state.objectVoxels, worldPoint, {
            source: 'Deep',
            viewId: frame.viewCluster,
            frameId: frame.id,
            roomId: room.id,
            color: colorAt(frame, u, v),
            weight: C.clamp(0.8 / Math.max(0.08, fit.medianError), 0.35, 1.6),
          }, CONFIG.objectVoxelSize);
          objects += 1;
        } else if (observedDistance - shell.distance > tolerance) {
          mask[index] = 3;
          optical += 1;
        } else {
          mask[index] = 1;
          structural += 1;
        }
      }
    }
    frame.deepMask = { width: CONFIG.deepGridX, height: CONFIG.deepGridY, data: mask };
    frame.deepClass = { structural, objects, optical, unknown, fitError: fit.medianError, fitCount: fit.count };
    pruneObjectVoxels();
    return frame.deepClass;
  }

  function deepMaskAt(frame, u, v) {
    if (!frame.deepMask) return 0;
    const x = C.clamp(Math.floor(u * frame.deepMask.width), 0, frame.deepMask.width - 1);
    const y = C.clamp(Math.floor(v * frame.deepMask.height), 0, frame.deepMask.height - 1);
    return frame.deepMask.data[y * frame.deepMask.width + x];
  }

  function selectProcessingFrames(profile) {
    const output = [];
    for (const room of state.rooms) {
      const candidates = roomFrames(room.id).filter(frame => frame.role === 'survey');
      const chosen = [];
      for (const frame of candidates.sort((a, b) => b.quality - a.quality)) {
        if (chosen.length >= profile.maxFrames) break;
        const diverse = chosen.every(existing => existing.viewCluster !== frame.viewCluster || C.angleDiff(existing.yaw, frame.yaw) > 0.32);
        if (diverse || chosen.length < 3) chosen.push(frame);
      }
      output.push(...chosen);
    }
    return output;
  }

  async function rebuildXRObjectVoxels() {
    state.objectVoxels = new Map();
    const frames = state.frames.filter(frame => frame.depthGrid);
    for (let index = 0; index < frames.length; index += 1) {
      if (state.process.cancel) throw new Error('PROCESS_CANCELLED');
      const frame = frames[index];
      const room = state.rooms.find(item => item.id === frame.roomId);
      if (!room?.model) continue;
      try {
        await ensureFrameRGBA(frame);
        classifyXRFrameObjects(frame, room);
      } finally {
        // Never retain multiple decoded keyframes. JPEG remains authoritative
        // and the next stage can decode this frame again if it really needs it.
        frame.rgba = null;
      }
      if (index % 2 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  function buildObjects() {
    const manualObjects = state.objects.filter(object => object.kind === 'manual');
    const components = C.connectedVoxelComponents(state.objectVoxels, CONFIG.objectVoxelSize, CONFIG.objectMinVoxels);
    const scanObjects = [];
    for (const component of components) {
      const object = C.objectFromVoxels(component, ++state.objectSequence, CONFIG.objectVoxelSize);
      const extent = object.obb.extent;
      if (Math.max(...extent) > 5.5 || Math.min(...extent) < 0.05) continue;
      object.id = `O${state.objectSequence}`;
      object.name = `Oggetto ${scanObjects.length + 1}`;
      scanObjects.push(object);
    }
    state.objects = [...manualObjects, ...scanObjects];
    renderObjectControls();
  }


  function objectVisualEvidence(object) {
    if (!object?.points?.length) return null;
    return C.visualFeaturesFromColors(object.points, { maximumSamples: 4096 });
  }

  function collectObjectVisualEvidence() {
    for (const object of activeObjects()) {
      const features = objectVisualEvidence(object);
      if (features?.sampleCount) {
        state.surfaceVisualEvidence[object.id] = features;
        object.rgbSummary = {
          mean: [...features.meanRgb],
          pointCount: object.points?.length || 0,
          sampleCount: features.sampleCount,
        };
      }
    }
  }

  function projectedSurfaceColor(frames, worldPoint) {
    let best = null;
    for (const frame of frames) {
      if (!frame.rgba || !frame.projection || !frame.worldToView) continue;
      const projected = C.projectPoint(frame.projection, frame.worldToView, worldPoint);
      if (!projected || projected.u < 0.025 || projected.u > 0.975 || projected.v < 0.025 || projected.v > 0.975) continue;
      const xrDepth = depthGridAt(frame.depthGrid, projected.u, projected.v);
      if (xrDepth && xrDepth < projected.depthZ - Math.max(0.10, 0.05 * projected.depthZ)) continue;
      if (deepMaskAt(frame, projected.u, projected.v) === 2) continue;
      const edge = Math.min(projected.u, 1 - projected.u, projected.v, 1 - projected.v);
      const score = (frame.quality || 0.4) * (0.58 + 0.42 * C.clamp(edge / 0.20));
      if (!best || score > best.score) best = { score, color: colorAt(frame, projected.u, projected.v) };
    }
    return best?.color || null;
  }

  function sampleHorizontalSurfaceVisualFeatures(room, role, frames) {
    if (!room?.model || !frames.length) return null;
    const polygon = room.model.footprint;
    const minX = Math.min(...polygon.map(point => point[0]));
    const maxX = Math.max(...polygon.map(point => point[0]));
    const minZ = Math.min(...polygon.map(point => point[1]));
    const maxZ = Math.max(...polygon.map(point => point[1]));
    const grid = 16;
    const colors = [];
    const y = role === 'floor' ? room.model.floorY + 0.015 : room.model.ceilingY - 0.015;
    for (let row = 0; row < grid; row += 1) {
      for (let column = 0; column < grid; column += 1) {
        const x = minX + (maxX - minX) * (column + 0.5) / grid;
        const z = minZ + (maxZ - minZ) * (row + 0.5) / grid;
        if (!C.pointInPolygon([x, z], polygon)) continue;
        const color = projectedSurfaceColor(frames, [x, y, z]);
        if (color) colors.push(color);
      }
    }
    return colors.length >= 8 ? C.visualFeaturesFromColors(colors, { maximumSamples: 1024 }) : null;
  }

  function refreshAcousticSurfaces() {
    collectObjectVisualEvidence();
    const previous = state.acousticSurfaces || [];
    state.acousticSurfaces = C.buildAcousticSurfaceModel(
      state.rooms.filter(room => room.model),
      activeObjects(),
      state.portals,
      state.surfaceVisualEvidence,
      previous,
    );
    if (!state.acousticSurfaces.some(surface => surface.id === state.acoustic.selectedId)) {
      state.acoustic.selectedId = state.acousticSurfaces[0]?.id || null;
    }
    renderAcousticControls();
    renderReview();
    return state.acousticSurfaces;
  }

  async function buildWallTextures(profile) {
    state.wallTextures = {};
    state.textureImages = {};
    state.surfaceVisualEvidence = {};
    collectObjectVisualEvidence();
    for (const room of state.rooms) {
      if (!room.model) continue;
      const roomCandidates = roomFrames(room.id)
        .filter(frame => frame.jpegDataUrl)
        .sort((a, b) => (b.quality || 0) - (a.quality || 0));

      // Floor and ceiling features use a small bounded batch, then every RGBA
      // buffer is released before any wall atlas is constructed.
      const roomVisualFrames = roomCandidates.slice(0, profile.id === 'accurate' ? 6 : 4);
      try {
        for (const frame of roomVisualFrames) await ensureFrameRGBA(frame);
        for (const role of ['floor', 'ceiling']) {
          const features = sampleHorizontalSurfaceVisualFeatures(room, role, roomVisualFrames);
          if (features?.sampleCount) state.surfaceVisualEvidence[`${room.id}:${role}`] = features;
        }
      } finally {
        for (const frame of roomVisualFrames) frame.rgba = null;
      }

      // Each wall is decoded, projected and released independently. This is
      // slower than holding an entire room in RAM but prevents OOM tab kills on
      // phones when processing several connected rooms.
      for (const wall of room.model.walls) {
        if (state.process.cancel) throw new Error('PROCESS_CANCELLED');
        const frames = roomCandidates
          .filter(frame => (frame.wallVisibility?.[wall.index] || 0) > 0.20)
          .slice(0, profile.id === 'accurate' ? 4 : 3);
        if (!frames.length) continue;
        const width = Math.max(48, Math.min(profile.textureMaxWidth, Math.round(wall.length * profile.texturePpm)));
        const height = Math.max(48, Math.min(profile.textureMaxHeight, Math.round(room.model.height * profile.texturePpm)));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        try {
          for (const frame of frames) await ensureFrameRGBA(frame);
          const imageData = context.createImageData(width, height);
          const pixels = imageData.data;
          // Keep acoustic evidence separate from the neutral atlas fallback:
          // only pixels genuinely projected from a camera frame may influence
          // the V10-style material prior.
          const photographedColors = [];
          let photographedPixelCount = 0;
          const acousticSampleStride = Math.max(1, Math.floor((width * height) / 4096));
          for (let py = 0; py < height; py += 1) {
            const yWorld = room.model.floorY + room.model.height * (1 - (py + 0.5) / height);
            for (let px = 0; px < width; px += 1) {
              const along = wall.length * (px + 0.5) / width;
              const worldPoint = C.wallPoint(wall, along, yWorld);
              let bestScore = -1;
              let bestColor = [145, 165, 178];
              for (const frame of frames) {
                const projected = C.projectPoint(frame.projection, frame.worldToView, worldPoint);
                if (!projected || projected.u < 0.01 || projected.u > 0.99 || projected.v < 0.01 || projected.v > 0.99) continue;
                const xrDepth = depthGridAt(frame.depthGrid, projected.u, projected.v);
                if (xrDepth && xrDepth < projected.depthZ - Math.max(0.09, 0.045 * projected.depthZ)) continue;
                if (deepMaskAt(frame, projected.u, projected.v) === 2) continue;
                const edge = Math.min(projected.u, 1 - projected.u, projected.v, 1 - projected.v);
                const score = frame.quality * (0.55 + 0.45 * C.clamp(edge / 0.18));
                if (score > bestScore) {
                  bestScore = score;
                  bestColor = colorAt(frame, projected.u, projected.v);
                }
              }
              const offset = 4 * (py * width + px);
              pixels[offset] = bestColor[0];
              pixels[offset + 1] = bestColor[1];
              pixels[offset + 2] = bestColor[2];
              pixels[offset + 3] = 255;
              if (bestScore >= 0) {
                photographedPixelCount += 1;
                if ((py * width + px) % acousticSampleStride === 0) photographedColors.push([...bestColor]);
              }
            }
            if (py && py % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
          }
          context.putImageData(imageData, 0, 0);
          const visualFeatures = photographedColors.length >= 8
            ? {
                ...C.visualFeaturesFromColors(photographedColors, { maximumSamples: 4096 }),
                coverage: photographedPixelCount / Math.max(1, width * height),
                evidence: 'projected-camera-rgb',
              }
            : null;
          const surfaceId = `${room.id}:wall:${wall.index}`;
          state.surfaceVisualEvidence[surfaceId] = visualFeatures;
          state.wallTextures[`${room.id}:${wall.index}`] = {
            roomId: room.id,
            wallIndex: wall.index,
            width,
            height,
            dataUrl: canvas.toDataURL('image/jpeg', 0.84),
            frameIds: frames.map(frame => frame.id),
            visualFeatures,
          };
        } finally {
          for (const frame of frames) frame.rgba = null;
          canvas.width = 1;
          canvas.height = 1;
        }
      }
      for (const frame of roomFrames(room.id)) frame.rgba = null;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  function fitMetricSceneFromSurfels(stage = 'final') {
    const fitResults = [];
    for (const room of state.rooms) {
      if (!room?.model) continue;
      if (!room.acquisitionFootprint) {
        room.acquisitionFootprint = room.footprint.map(point => [...point]);
        room.acquisitionHeight = room.height;
      }
      const acquisitionModel = C.buildRoomModel(
        room.acquisitionFootprint,
        room.model.floorY || 0,
        room.acquisitionHeight || room.height || CONFIG.defaultHeight,
      );
      const roomSurfels = state.surfelMap.values().filter(surfel => {
        if (surfel.roomIds?.[String(room.id)]) return true;
        return G.roomForPoint(surfel.position, [{ ...room, model: acquisitionModel }])?.id === room.id;
      });
      const result = G.fitRoomHybrid({ ...room, model: acquisitionModel }, roomSurfels, {
        maximumAngleDegrees: CONFIG.roomFitMaximumAngleDegrees,
        maximumOffset: CONFIG.roomFitMaximumOffset,
        maximumCornerShift: CONFIG.roomFitMaximumCornerShift,
        supportDistance: 0.34,
        minimumWallPoints: 10,
        maximumHeightCorrection: 0.35,
      });
      if (result.ok && result.model) {
        room.fittedModel = result.model;
        room.model = result.model;
        room.footprint = result.model.footprint.map(point => [...point]);
        room.height = result.model.height;
        room.geometryFit = {
          stage,
          algorithm: 'bounded-robust-wall-fit-v20-1',
          surfels: roomSurfels.length,
          diagnostics: result.diagnostics || [],
          ceiling: result.ceiling || null,
          meanConfidence: result.meanConfidence || 0,
          reverted: Boolean(result.reverted),
        };
      }
      fitResults.push({ roomId: room.id, ...result, model: undefined });
    }
    state.geometryFitResults = fitResults;
    log('METRIC_SCENE_FIT', 'INFO', {
      stage,
      rooms: fitResults.length,
      surfels: state.surfelMap.map.size,
      refined: fitResults.filter(item => item.ok && !item.reverted).length,
    });
    return fitResults;
  }

  function fuseDeepFrameIntoMetricMap(frame, room) {
    if (!frame?.deep?.data || !room?.model) return null;
    const result = G.fuseRelativeDepthFrame(
      state.surfelMap,
      {
        id: frame.id,
        roomId: room.id,
        projection: frame.projection,
        poseMatrix: frame.worldFromView,
        worldToView: frame.worldToView,
        rgba: frame.rgba,
        width: frame.rgbWidth,
        height: frame.rgbHeight,
        xrDepth: frame.depthGrid ? {
          values: frame.depthGrid.data,
          width: frame.depthGrid.width,
          height: frame.depthGrid.height,
        } : null,
      },
      frame.deep.data,
      frame.deep.width,
      frame.deep.height,
      state.rooms,
      {
        fusionStride: 1,
        anchorStride: 2,
        shellAnchorStride: 6,
        minimumDepth: CONFIG.minDepth,
        maximumDepth: CONFIG.maxDepth,
      },
    );
    frame.metricDeepFit = result.fit || null;
    frame.metricSurfelUpdate = { accepted: result.accepted || 0, rejected: result.rejected || 0 };
    return result;
  }

  async function hydrateAcousticMeasurementRecords() {
    if (!state.audio.enabled && !state.audio.manifests.length) return [];
    const controller = ensureAudioController();
    const inMemory = new Map(controller.measurements.map(record => [String(record.id), record]));
    const missing = state.audio.manifests.filter(manifest => !inMemory.has(String(manifest.id)));
    if (missing.length) {
      try {
        const loaded = await controller.loadAll(missing);
        for (const record of loaded) {
          if (!inMemory.has(String(record.id))) {
            controller.measurements.push(record);
            inMemory.set(String(record.id), record);
          }
        }
      } catch (error) {
        log('RIR_STORAGE_LOAD_FAILED', 'WARN', { error: errorText(error), missing: missing.length });
      }
    }
    const records = [...inMemory.values()];
    for (const record of records) {
      if (!record.sweep) record.sweep = controller.regenerateSweep(record);
    }
    return records;
  }

  function compactRirAnalysis(measurement) {
    if (!measurement) return measurement;
    return {
      id: measurement.id,
      ok: measurement.ok,
      reason: measurement.reason || null,
      roomId: measurement.roomId ?? null,
      sourcePosition: measurement.sourcePosition || null,
      receiverPosition: measurement.receiverPosition || null,
      sampleRate: measurement.sampleRate || null,
      directIndex: measurement.directIndex ?? null,
      latency: measurement.latency || null,
      quality: measurement.quality || null,
      peakToTailDb: measurement.analysis?.peakToTailDb ?? null,
      decay: measurement.analysis?.decay || null,
      broadbandDecay: measurement.analysis?.broadbandDecay || null,
      peaks: (measurement.analysis?.peaks || []).map(peak => ({
        sample: peak.sample,
        delaySeconds: peak.delaySeconds,
        delayMs: peak.delayMs,
        energyRatioDirect: peak.energyRatioDirect,
        snrDb: peak.snrDb,
      })),
      associations: (measurement.associations || []).map(association => ({
        peak: {
          sample: association.peak?.sample,
          delaySeconds: association.peak?.delaySeconds,
          delayMs: association.peak?.delayMs,
          snrDb: association.peak?.snrDb,
        },
        unassignedPosterior: association.unassignedPosterior,
        entropy: association.entropy,
        candidates: (association.candidates || []).slice(0, 6).map(candidate => ({
          zoneId: candidate.zoneId,
          ownerSurfaceId: candidate.ownerSurfaceId,
          posterior: candidate.posterior,
          predictedDelaySeconds: candidate.predictedDelaySeconds,
          observedDelaySeconds: candidate.observedDelaySeconds,
          residualSeconds: candidate.residualSeconds,
          reflectionPoint: candidate.reflectionPoint,
          geometryConfidence: candidate.geometryConfidence,
        })),
      })),
    };
  }

  async function processAcousticMeasurements() {
    refreshAcousticSurfaces();
    state.acousticZones = A.buildAcousticZones(
      state.rooms.filter(room => room.model),
      state.geometryGaussians,
      state.acousticSurfaces,
      {
        wallZoneWidth: 1.0,
        wallZoneHeight: 1.15,
        maximumWallColumns: 8,
        maximumWallRows: 3,
        maximumGaussianZones: 5000,
      },
    );
    const records = await hydrateAcousticMeasurementRecords();
    if (!records.length) {
      state.rirAnalyses = [];
      state.acousticInference = A.inferZoneAbsorption([], state.acousticZones, state.rooms, { bands: C.ACOUSTIC_BANDS });
      // No RIR means no measured inference. Keep the conservative visual priors
      // on the surface model and expose zero-support zone estimates only in the
      // diagnostics/export; otherwise the UI would misleadingly label every
      // surface as RIR-inferred.
      log('RIR_INFERENCE_SKIPPED', 'WARN', { reason: 'no-measurements' });
      return { measurements: 0, successful: 0 };
    }
    const controller = ensureAudioController();
    const analyses = [];
    for (let index = 0; index < records.length; index += 1) {
      if (state.process.cancel) throw new Error('PROCESS_CANCELLED');
      const record = records[index];
      updateProcessUI(
        `RIR ${index + 1}/${records.length}`,
        0.89 + 0.075 * index / Math.max(1, records.length),
        'Deconvoluzione Kirkeby, allineamento al diretto e posteriori riflessione-superficie.',
      );
      try {
        const deconvolved = A.deconvolveMeasurement(record, {
          bands: C.ACOUSTIC_BANDS,
          maximumPeaks: 18,
          tailSeconds: 2.6,
          minimumPeakSnrDb: 5.5,
        });
        if (!deconvolved.ok) {
          analyses.push({ ok: false, id: record.id, roomId: record.roomId, reason: deconvolved.reason });
          continue;
        }
        record.onsetSample = deconvolved.onsetSample;
        record.onsetDetection = deconvolved.detection || null;
        record.directIndex = deconvolved.directIndex;
        record.rawDirectIndex = deconvolved.rawDirectIndex;
        controller.resolvePose(record, state.metricPath);
        const measurement = A.analyzeMeasurement({
          ...record,
          ir: deconvolved.ir,
          directIndex: deconvolved.directIndex,
          sampleRate: deconvolved.sampleRate,
          receiverPosition: record.receiverPosition || record.receiverPoseAtSchedule?.p,
        }, state.acousticZones.all, {
          bands: C.ACOUSTIC_BANDS,
          maximumPeaks: 18,
          minimumPeakSnrDb: 5.5,
          maximumCandidatesPerEcho: 10,
          unassignedPrior: 0.001,
        });
        measurement.latency = {
          ...(measurement.latency || {}),
          detectedOnsetSample: deconvolved.onsetSample,
          rawDirectIndex: deconvolved.rawDirectIndex,
          directAligned: true,
        };
        analyses.push(measurement);
      } catch (error) {
        analyses.push({ ok: false, id: record.id, roomId: record.roomId, reason: errorText(error) });
        log('RIR_ANALYSIS_FAILED', 'WARN', { id: record.id, error: errorText(error) });
      }
      if (index % 2 === 1) await new Promise(resolve => setTimeout(resolve, 0));
    }
    state.acousticInference = A.inferZoneAbsorption(analyses, state.acousticZones, state.rooms, {
      bands: C.ACOUSTIC_BANDS,
      minimumPosterior: 0.12,
    });
    A.applyInferenceToAcousticSurfaces(state.acousticSurfaces, state.acousticInference);
    state.rirAnalyses = analyses.map(compactRirAnalysis);
    log('RIR_SURFACE_INFERENCE_COMPLETE', 'INFO', {
      measurements: records.length,
      successful: analyses.filter(item => item.ok).length,
      zones: state.acousticInference.zones.length,
    });
    return { measurements: records.length, successful: analyses.filter(item => item.ok).length };
  }

  async function processModel() {
    if (state.process.running) return;
    if (state.session || state.navigationExitPending) {
      alert('Termina prima la scansione WebXR. Deep e la stima RIR vengono eseguiti solo dopo la chiusura ordinata della sessione.');
      return;
    }
    if (!state.postXrReady || state.handoffPending) {
      alert('Sto ancora completando il salvataggio leggero di camera, audio e checkpoint. Il processing verra abilitato nello stesso documento appena i buffer sono stati rilasciati.');
      return;
    }
    if (!state.rooms.some(room => room.model) || !state.frames.length) {
      alert('Completa almeno un vano con alcune fotografie. Le RIR da sole non sono sufficienti per vincolare le superfici.');
      return;
    }

    const profile = qualityProfile();
    const frames = selectProcessingFrames(profile);
    state.process = {
      running: true,
      cancel: false,
      total: frames.length,
      done: 0,
      fused: 0,
      stage: '',
      rirTotal: state.audio.manifests.length || state.audioController?.measurements?.length || 0,
      rirDone: 0,
    };
    updateProcessingAvailability();
    showProcess(true);

    let deepAvailable = true;
    let rirResult = { measurements: 0, successful: 0 };
    try {
      updateProcessUI(
        'Mappa metrica WebXR',
        0.02,
        'Ricostruzione dei residui oggetto e fusione bounded dei campioni depth nel reference space local-floor.',
      );
      await rebuildXRObjectVoxels();
      fitMetricSceneFromSurfels('xr-only');

      try {
        await ensureDepthWorker(profile.input);
      } catch (error) {
        deepAvailable = false;
        log('DEEP_UNAVAILABLE_XR_ONLY', 'WARN', { error: errorText(error) });
        updateProcessUI(
          'Deep non disponibile',
          0.62,
          'Conservo scala, pose e superfici WebXR; continuo con RIR, oggetti XR/manuali e texture fotografiche.',
        );
      }

      if (deepAvailable) {
        for (let index = 0; index < frames.length; index += 1) {
          if (state.process.cancel) throw new Error('PROCESS_CANCELLED');
          const frame = frames[index];
          const room = state.rooms.find(item => item.id === frame.roomId);
          updateProcessUI(
            `Deep metrico ${index + 1}/${frames.length}`,
            0.07 + 0.48 * index / Math.max(1, frames.length),
            `${room?.name || frame.roomId}: profondita relativa calibrata con depth WebXR e intersezioni della shell metrica.`,
          );
          try {
            await inferDepth(frame, profile);
            classifyDeepFrame(frame, room);
            const fused = fuseDeepFrameIntoMetricMap(frame, room);
            frame.status = fused?.accepted > 0 ? 'processed' : 'weak';
            if (fused?.accepted > 0) state.process.fused += 1;
            if (!fused?.accepted) {
              frame.reason = fused?.reason || fused?.fit?.reason || 'deep-metric-fit-insufficient';
              log('DEEP_FRAME_METRIC_WEAK', 'WARN', { frameId: frame.id, reason: frame.reason });
            }
          } catch (error) {
            frame.status = 'weak';
            frame.reason = errorText(error);
            log('DEEP_FRAME_WEAK', 'WARN', { frameId: frame.id, error: frame.reason });
          } finally {
            // Deep and RGBA are deliberately freed frame-by-frame. The metric
            // surfels and object voxels are the compact persistent products.
            frame.deep = null;
            frame.rgba = null;
          }
          state.process.done = index + 1;
          updateProcessUI(
            `Deep metrico ${index + 1}/${frames.length}`,
            0.07 + 0.48 * (index + 1) / Math.max(1, frames.length),
          );
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      } else {
        // The UI counter must still describe the selected batch when Deep is
        // unavailable; no fake successful frames are reported.
        state.process.done = 0;
      }

      updateProcessUI(
        'Fit metrico vincolato',
        0.58,
        'Le pareti possono correggersi solo localmente rispetto al poligono tracciato: nessun ICP globale e nessuna perdita della scala WebXR.',
      );
      fitMetricSceneFromSurfels(deepAvailable ? 'xr+deep' : 'xr-only-final');
      state.geometryGaussians = G.buildGeometryGaussians(state.surfelMap, state.rooms, {
        cellSize: CONFIG.geometryGaussianCellSize,
        maximumGaussians: CONFIG.geometryGaussianMaxCount,
      });

      updateProcessUI(
        'Oggetti RGB',
        0.66,
        'Componenti voxel persistenti da viste distinte, con nuvola RGB, mesh esterna e ingombro OBB editabile.',
      );
      buildObjects();

      updateProcessUI(
        'Texture delle superfici',
        0.73,
        'Proiezione bounded dei keyframe migliori sulle superfici metriche; i raster vengono decodificati uno alla volta.',
      );
      await buildWallTextures(profile);
      refreshAcousticSurfaces();

      updateProcessUI(
        'RIR e riflessioni',
        0.83,
        'Deconvoluzione ESS/Kirkeby, allineamento al cammino diretto e associazione probabilistica a zone di parete o Gaussiane.',
      );
      rirResult = await processAcousticMeasurements();
      state.process.rirTotal = rirResult.measurements;
      state.process.rirDone = rirResult.successful;

      state.phase = 'processed';
      const fitSummary = state.rooms
        .filter(room => room.model)
        .map(room => room.geometryFit?.meanConfidence || 0);
      const meanFit = fitSummary.length
        ? fitSummary.reduce((sum, value) => sum + value, 0) / fitSummary.length
        : 0;
      updateProcessUI(
        'Completato',
        1,
        `${state.rooms.length} vani, ${state.surfelMap.map.size} surfel metrici, ${state.geometryGaussians.length} Gaussiane, ${state.objects.length} oggetti RGB, ${rirResult.successful}/${rirResult.measurements} RIR analizzate, fit medio ${(100 * meanFit).toFixed(0)}%.${deepAvailable ? '' : ' Modalita XR-only.'}`,
      );
      scheduleCheckpoint('processing-completed', 40);
      renderReview();
      renderPlan();
      renderScene();
      setTimeout(() => {
        showProcess(false);
        openScene();
      }, 250);
    } catch (error) {
      if (errorText(error) !== 'PROCESS_CANCELLED') {
        alert(errorText(error));
        log('PROCESS_FAILED', 'ERROR', { error: errorText(error) });
        try { globalThis.RoomScanDiagnostics?.captureFault?.(error, 'PROCESS_FAILED', { stage: state.process.stage, done: state.process.done, total: state.process.total }); } catch {}
      }
      showProcess(false);
    } finally {
      destroyDepthWorker('Batch completato o interrotto');
      state.process.running = false;
      updateProcessingAvailability();
      updateLandingSummary();
    }
  }

  function updateProcessUI(stage, progress, detail = '') {
    state.process.stage = stage;
    $('processStage').textContent = stage;
    $('processFill').style.width = `${C.clamp(progress) * 100}%`;
    $('deepCount').textContent = `${state.process.done}/${state.process.total}`;
    $('fusedCount').textContent = String(state.process.fused);
    $('objectCount').textContent = String(state.objects.length);
    const rirElement = $('rirCount');
    if (rirElement) rirElement.textContent = `${state.process.rirDone || 0}/${state.process.rirTotal || 0}`;
    if (detail) $('processDetail').textContent = detail;
  }

  function showProcess(visible) {
    $('processModal').classList.toggle('hidden', !visible);
  }

  /* -----------------------------------------------------------------------
   * HUD and AR overlay
   * -------------------------------------------------------------------- */

  function canvas2D(id) {
    const canvas = $(id);
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(2, Math.round(rect.width * pixelRatio));
    const height = Math.max(2, Math.round(rect.height * pixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    return { canvas, context, width: rect.width, height: rect.height };
  }

  function projectGlobal(point) {
    return state.currentProjection && state.currentPoseMatrix
      ? C.projectPoint(state.currentProjection, C.invert4(state.currentPoseMatrix), point)
      : null;
  }

  function screenPoint(projected, width, height) {
    return projected ? { x: projected.u * width, y: projected.v * height } : null;
  }

  function drawLine(context, a, b, color, lineWidth = 2, dash = []) {
    if (!a || !b) return;
    context.save();
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.setLineDash(dash);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
    context.restore();
  }

  function drawReticle(context, width, height, good) {
    const x = width / 2;
    const y = height * 0.52;
    context.strokeStyle = good ? '#62e6a5' : '#ffffff';
    context.lineWidth = 2.5;
    context.beginPath();
    context.arc(x, y, 12, 0, Math.PI * 2);
    context.moveTo(x - 18, y);
    context.lineTo(x - 5, y);
    context.moveTo(x + 5, y);
    context.lineTo(x + 18, y);
    context.moveTo(x, y - 18);
    context.lineTo(x, y - 5);
    context.moveTo(x, y + 5);
    context.lineTo(x, y + 18);
    context.stroke();
  }

  function drawRoomWire(context, width, height, room) {
    if (!room?.model) return;
    for (const wall of room.model.walls) {
      const floorA = screenPoint(projectGlobal([wall.a[0], room.model.floorY, wall.a[1]]), width, height);
      const floorB = screenPoint(projectGlobal([wall.b[0], room.model.floorY, wall.b[1]]), width, height);
      const topA = screenPoint(projectGlobal([wall.a[0], room.model.ceilingY, wall.a[1]]), width, height);
      const topB = screenPoint(projectGlobal([wall.b[0], room.model.ceilingY, wall.b[1]]), width, height);
      drawLine(context, floorA, floorB, '#65d9ff', 2);
      drawLine(context, topA, topB, '#bd98ff', 1.7);
      drawLine(context, floorA, topA, '#65d9ff99', 1.2);
    }
  }

  function photoTargetPalette(status) {
    if (status === 'green') {
      return { stroke: '#62e6a5', fill: 'rgba(55, 218, 143, .11)', text: '#baffdc', dash: [5, 5] };
    }
    if (status === 'yellow') {
      return { stroke: '#ffd166', fill: 'rgba(255, 209, 102, .14)', text: '#ffe9ad', dash: [10, 6] };
    }
    return { stroke: '#ff6478', fill: 'rgba(255, 72, 96, .17)', text: '#ffd1d7', dash: [] };
  }

  function photoTargetViewCount(target) {
    return new Set((target?.observations || []).map(observation => (
      observation.viewCluster ?? `frame:${observation.frameId}`
    ))).size;
  }

  function drawTargetCornerMarks(context, points, color, size = 14) {
    if (points.length !== 4) return;
    context.save();
    context.strokeStyle = color;
    context.lineWidth = 4;
    context.lineCap = 'round';
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const previous = points[(index + 3) % points.length];
      const next = points[(index + 1) % points.length];
      const towardPrevious = {
        x: point.x + (previous.x - point.x) / Math.max(1, Math.hypot(previous.x - point.x, previous.y - point.y)) * size,
        y: point.y + (previous.y - point.y) / Math.max(1, Math.hypot(previous.x - point.x, previous.y - point.y)) * size,
      };
      const towardNext = {
        x: point.x + (next.x - point.x) / Math.max(1, Math.hypot(next.x - point.x, next.y - point.y)) * size,
        y: point.y + (next.y - point.y) / Math.max(1, Math.hypot(next.x - point.x, next.y - point.y)) * size,
      };
      context.beginPath();
      context.moveTo(towardPrevious.x, towardPrevious.y);
      context.lineTo(point.x, point.y);
      context.lineTo(towardNext.x, towardNext.y);
      context.stroke();
    }
    context.restore();
  }

  function drawPhotoTargetBox(context, width, height, target, selected = false) {
    const evaluation = evaluateTargetNow(target);
    const projectedCorners = evaluation?.corners || [];
    if (!evaluation?.visible || projectedCorners.length !== 4 || projectedCorners.some(point => !point)) return evaluation;
    const points = projectedCorners.map(point => ({ x: point.u * width, y: point.v * height }));
    const minX = Math.min(...points.map(point => point.x));
    const maxX = Math.max(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const maxY = Math.max(...points.map(point => point.y));
    if (maxX < -20 || minX > width + 20 || maxY < -20 || minY > height + 20) return evaluation;
    const status = C.photoTargetStatus(target);
    const palette = photoTargetPalette(status);
    context.save();
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) context.lineTo(points[index].x, points[index].y);
    context.closePath();
    context.fillStyle = palette.fill;
    context.fill();
    context.strokeStyle = palette.stroke;
    context.lineWidth = selected ? 5 : status === 'green' ? 2 : 3;
    context.setLineDash(palette.dash);
    context.stroke();
    context.restore();

    if (selected) drawTargetCornerMarks(context, points, '#ffffff', 18);
    if (selected || status !== 'green') {
      const center = {
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      };
      const views = photoTargetViewCount(target);
      const label = status === 'green'
        ? 'OK'
        : `${status === 'red' ? 'FOTO' : 'ALTRA VISTA'} ${views}/${Math.max(1, target.requiredViews || 1)}`;
      context.save();
      context.font = selected ? '900 12px system-ui' : '800 10px system-ui';
      const labelWidth = Math.min(170, context.measureText(label).width + 18);
      context.fillStyle = 'rgba(3, 12, 18, .78)';
      context.fillRect(center.x - labelWidth / 2, center.y - 13, labelWidth, 26);
      context.strokeStyle = palette.stroke;
      context.lineWidth = 1.5;
      context.strokeRect(center.x - labelWidth / 2, center.y - 13, labelWidth, 26);
      context.fillStyle = palette.text;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(label, center.x, center.y + 1, labelWidth - 8);
      context.restore();
    }
    return evaluation;
  }

  function drawTargetArrow(context, width, height, guide) {
    if (!guide.target) return;
    const palette = photoTargetPalette(guide.targetStatus);
    const safeTop = Math.max(92, height * 0.16);
    const safeBottom = height - Math.max(190, height * 0.24);
    let destination = null;
    if (guide.evaluation?.center) {
      destination = {
        x: C.clamp(guide.evaluation.center.u * width, 32, width - 32),
        y: C.clamp(guide.evaluation.center.v * height, safeTop, safeBottom),
      };
    } else {
      destination = {
        x: guide.turn === 'right' ? width - 42 : 42,
        y: height * 0.46,
      };
    }
    const origin = { x: width / 2, y: height * 0.50 };
    const dx = destination.x - origin.x;
    const dy = destination.y - origin.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const tip = { x: destination.x, y: destination.y };
    const base = { x: tip.x - ux * 25, y: tip.y - uy * 25 };
    const normal = { x: -uy, y: ux };
    context.save();
    context.strokeStyle = palette.stroke;
    context.fillStyle = palette.stroke;
    context.lineWidth = 8;
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(origin.x + ux * 24, origin.y + uy * 24);
    context.lineTo(base.x, base.y);
    context.stroke();
    context.beginPath();
    context.moveTo(tip.x, tip.y);
    context.lineTo(base.x + normal.x * 14, base.y + normal.y * 14);
    context.lineTo(base.x - normal.x * 14, base.y - normal.y * 14);
    context.closePath();
    context.fill();
    const tag = guide.needsNewView ? 'SPOSTATI' : guide.targetStatus === 'yellow' ? 'SECONDA VISTA' : 'PROSSIMA CASELLA';
    const tagX = C.clamp((origin.x + destination.x) / 2, 88, width - 88);
    const tagY = C.clamp((origin.y + destination.y) / 2 - 24, safeTop, safeBottom);
    context.font = '900 13px system-ui';
    const tagWidth = Math.min(width - 34, context.measureText(tag).width + 26);
    context.fillStyle = 'rgba(3, 12, 18, .82)';
    context.fillRect(tagX - tagWidth / 2, tagY - 15, tagWidth, 30);
    context.strokeStyle = palette.stroke;
    context.lineWidth = 1.5;
    context.strokeRect(tagX - tagWidth / 2, tagY - 15, tagWidth, 30);
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(tag, tagX, tagY + 1, tagWidth - 10);
    context.restore();
  }

  function drawCoverageGuide(context, width, height, room) {
    const guide = coverageGuidance(room);
    const targets = ensureRoomPhotoTargets(room);
    for (const target of targets) {
      if (target === guide.target) continue;
      drawPhotoTargetBox(context, width, height, target, false);
    }
    if (guide.target) drawPhotoTargetBox(context, width, height, guide.target, true);

    if (guide.target && (!guide.aligned || guide.needsNewView)) drawTargetArrow(context, width, height, guide);
    if (guide.target && guide.aligned && !guide.needsNewView) {
      drawReticle(context, width, height, guide.stable);
    }

    const panelWidth = width * 0.88;
    const panelX = (width - panelWidth) / 2;
    const panelY = Math.max(108, height * 0.24);
    context.save();
    context.fillStyle = 'rgba(3, 12, 18, .78)';
    context.fillRect(panelX, panelY, panelWidth, 76);
    context.strokeStyle = guide.target ? photoTargetPalette(guide.targetStatus).stroke : '#62e6a5';
    context.lineWidth = 1.5;
    context.strokeRect(panelX, panelY, panelWidth, 76);
    context.textAlign = 'center';
    context.fillStyle = '#ffffff';
    context.font = '900 16px system-ui';
    context.fillText(guide.instruction, width / 2, panelY + 27, panelWidth - 20);
    context.font = '11px ui-monospace, monospace';
    context.fillStyle = '#d5e8f2';
    context.fillText(`rosse ${guide.red}  |  gialle ${guide.yellow}  |  verdi ${guide.green}/${guide.total}`, width / 2, panelY + 51, panelWidth - 20);
    context.font = '10px system-ui';
    context.fillStyle = '#b9ced9';
    context.fillText(`${guide.frames} foto da ${guide.views} posizioni`, width / 2, panelY + 68, panelWidth - 20);
    context.restore();
  }

  function renderOverlay() {
    const overlay = $('overlayCanvas');
    if (!overlay || overlay.classList.contains('hidden')) return;
    const surface = canvas2D('overlayCanvas');
    if (!surface) return;
    const { context, width, height } = surface;
    context.clearRect(0, 0, width, height);
    const room = activeRoom();
    $('screenTint').classList.remove('hidden');

    if (state.phase === 'source-mark') {
      drawReticle(context, width, height, Boolean(state.aimPoint || state.hitPoint));
      context.fillStyle = 'rgba(3,12,18,.78)';
      context.fillRect(width * 0.08, height * 0.30, width * 0.84, 112);
      context.textAlign = 'center';
      context.fillStyle = '#ffffff';
      context.font = '900 18px system-ui';
      context.fillText('Inquadra l’altoparlante fisso', width / 2, height * 0.30 + 36);
      context.font = '12px system-ui';
      context.fillStyle = '#d5e8f2';
      context.fillText('Mira al centro del diffusore e premi “Segna sorgente”', width / 2, height * 0.30 + 66);
      context.fillStyle = '#ffd166';
      context.fillText('Se non usi un diffusore esterno scegli “Usa telefono”', width / 2, height * 0.30 + 91);
      return;
    }

    if (state.phase === 'corners') {
      drawReticle(context, width, height, Boolean(state.aimPoint));
      if (room?.footprint?.length) {
        for (let index = 0; index < room.footprint.length; index += 1) {
          const point = room.footprint[index];
          const projected = screenPoint(projectGlobal([point[0], 0, point[1]]), width, height);
          const previous = index > 0
            ? screenPoint(projectGlobal([room.footprint[index - 1][0], 0, room.footprint[index - 1][1]]), width, height)
            : null;
          if (projected) {
            context.fillStyle = '#65d9ff';
            context.beginPath();
            context.arc(projected.x, projected.y, 6, 0, Math.PI * 2);
            context.fill();
            context.fillStyle = '#ffffff';
            context.font = 'bold 11px system-ui';
            context.fillText(String(index + 1), projected.x + 8, projected.y - 7);
          }
          drawLine(context, previous, projected, '#65d9ff', 2.5);
        }
      }
      return;
    }

    if (room?.model) drawRoomWire(context, width, height, room);
    if (state.audio.fixedSourcePosition) {
      const sourcePoint = screenPoint(projectGlobal(state.audio.fixedSourcePosition), width, height);
      if (sourcePoint) {
        context.fillStyle = '#ffd166';
        context.beginPath();
        context.arc(sourcePoint.x, sourcePoint.y, 9, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#07131c';
        context.font = '900 10px system-ui';
        context.textAlign = 'center';
        context.fillText('S', sourcePoint.x, sourcePoint.y + 3);
      }
    }
    if (state.phase === 'height') {
      drawReticle(context, width, height, Boolean(state.heightCandidate));
      if (state.heightCandidate?.point) {
        const projected = screenPoint(projectGlobal(state.heightCandidate.point), width, height);
        if (projected) {
          context.fillStyle = '#62e6a5';
          context.beginPath();
          context.arc(projected.x, projected.y, 8, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.fillStyle = 'rgba(3,12,18,.72)';
      context.fillRect(width * 0.12, height * 0.35, width * 0.76, 82);
      context.fillStyle = '#ffffff';
      context.textAlign = 'center';
      context.font = '800 16px system-ui';
      context.fillText('Mira al raccordo parete-soffitto', width / 2, height * 0.35 + 30);
      context.font = '12px ui-monospace, monospace';
      context.fillStyle = state.heightCandidate ? '#62e6a5' : '#ffd166';
      context.fillText(state.heightCandidate ? `H ${state.heightCandidate.height.toFixed(2)} m` : 'Nessuna intersezione valida', width / 2, height * 0.35 + 57);
    }
    if (state.phase === 'coverage' && room) {
      // Physical wall tiles are drawn directly in camera space. A full-screen
      // red tint is intentionally avoided because it obscures the actual area
      // the user must photograph.
      drawCoverageGuide(context, width, height, room);
    }
    if (state.phase === 'transition') {
      drawReticle(context, width, height, Boolean(state.transition.crossing));
      context.fillStyle = 'rgba(3,12,18,.76)';
      context.fillRect(width * 0.10, height * 0.36, width * 0.80, 95);
      context.textAlign = 'center';
      context.fillStyle = state.transition.crossing ? '#62e6a5' : '#ffffff';
      context.font = '900 22px system-ui';
      context.fillText(state.transition.crossing ? 'Passaggio rilevato' : 'Attraversa la porta', width / 2, height * 0.36 + 35);
      context.font = '12px system-ui';
      context.fillStyle = '#d5e8f2';
      context.fillText('Poi premi "Sono nel nuovo vano"', width / 2, height * 0.36 + 65);
    }
  }

  function phaseLabel() {
    switch (state.phase) {
      case 'starting': return 'Avvio tracking';
      case 'source-mark': return '0 | Posizione sorgente acustica';
      case 'starting-room': return 'Avvio primo vano';
      case 'corners': return '1 | Angoli pavimento';
      case 'height': return '2 | Altezza soffitto';
      case 'coverage': return '3 | Caselle foto e oggetti';
      case 'room-ready': return 'Vano completato';
      case 'transition': return 'Passaggio al vano successivo';
      case 'finished': return 'Acquisizione terminata';
      case 'processed': return 'Modello processato';
      default: return 'Room Scanner';
    }
  }

  function statusDescription() {
    const room = activeRoom();
    switch (state.phase) {
      case 'starting': return 'Mantieni il telefono fermo finché compare il reticolo.';
      case 'source-mark': return 'Inquadra il centro dell’altoparlante esterno. Questa posizione resterà fissa per tutte le RIR.';
      case 'starting-room': return 'Sorgente acquisita. Inizializzo il primo vano.';
      case 'corners': return `Mira al raccordo pavimento-parete e aggiungi gli angoli in ordine. ${room?.footprint.length || 0} acquisiti.`;
      case 'height': return 'Mira una volta al raccordo parete-soffitto. La parete metrica trasforma il raggio in altezza.';
      case 'coverage': return coverageGuidance(room).instruction;
      case 'room-ready': return state.finishArmUntil > nowMs()
        ? 'Chiusura armata: tocca di nuovo solo se hai davvero finito tutti i vani.'
        : 'Vano salvato. Attraversa un passaggio per aggiungere un vano, oppure termina l intera scansione.';
      case 'transition': return state.transition.crossing ? 'Il confine del vano e stato attraversato.' : 'Cammina attraverso la porta o apertura mantenendo WebXR attivo.';
      default: return 'Scansione guidata nello stesso reference space metrico.';
    }
  }

  function updateCapabilityBadges() {
    const labels = [];
    if (state.capabilities.camera) labels.push('RGB XR');
    if (state.capabilities.depth) labels.push('DEPTH XR');
    if (state.capabilities.hitTest) labels.push('HIT TEST');
    if (state.capabilities.anchors) labels.push('ANCHOR');
    if (state.capabilities.planes) labels.push('PLANES');
    $('capabilities').textContent = labels.length ? labels.join(' | ') : 'POSE XR';
  }

  function updateHUD() {
    if (!$('phaseTitle')) return;
    if (state.finishArmUntil && state.finishArmUntil <= nowMs()) state.finishArmUntil = 0;
    const room = activeRoom();
    const locked = actionsLocked();
    const guide = state.phase === 'coverage' && room?.model ? coverageGuidance(room) : null;
    const readiness = room?.model ? roomCompletionReadiness(room) : null;
    $('phaseTitle').textContent = phaseLabel();
    $('statusText').textContent = statusDescription();
    $('trackingBadge').textContent = state.trackingLost ? 'TRACKING PERSO' : 'TRACKING OK';
    $('trackingBadge').className = `badge ${state.trackingLost ? 'bad' : 'good'}`;
    updateCapabilityBadges();
    updateAudioUI();
    const camera = state.currentCamera;
    const stats = room?.model ? coverageStats(room) : null;
    $('metricText').textContent = camera
      ? `x ${camera.position[0].toFixed(2)} | y ${camera.position[1].toFixed(2)} | z ${camera.position[2].toFixed(2)} m | v ${state.motion.linear.toFixed(2)} m/s | surfel ${state.surfelMap.map.size} | RIR ${state.audio.manifests.length + (state.audioController?.pending?.size || 0)}${room?.model ? ` | area ${room.model.area.toFixed(2)} m2 | H ${room.model.height.toFixed(2)} m` : ''}`
      : 'Attendo posa WebXR...';
    $('roomProgressFill').style.width = `${stats ? stats.score * 100 : 0}%`;

    const coach = $('coverageCoach');
    if (coach) {
      coach.classList.toggle('hidden', !guide);
      if (guide) {
        const direction = $('coverageDirection');
        const symbols = { right: '→', left: '←', up: '↑', down: '↓', center: guide.target ? '◎' : '✓' };
        direction.textContent = symbols[guide.turn] || '◎';
        const palette = photoTargetPalette(guide.targetStatus || 'green');
        direction.style.color = palette.stroke;
        direction.style.borderColor = palette.stroke;
        direction.style.background = palette.fill;
        $('coverageInstruction').textContent = guide.instruction;
        $('coverageDetail').textContent = guide.detail;
        $('coverageCounts').textContent = `rosse ${guide.red} · gialle ${guide.yellow} · verdi ${guide.green}/${guide.total} · ${guide.frames} foto`;
      }
    }

    const runtimeNotice = $('runtimeNotice');
    if (runtimeNotice) {
      const recentError = state.runtimeError && nowMs() - state.runtimeErrorAt < 9000;
      runtimeNotice.classList.toggle('hidden', !recentError);
      if (recentError) $('runtimeNoticeText').textContent = `${state.runtimeError.source}: ${state.runtimeError.message}`;
    }

    const primary = $('primaryButton');
    const secondary = $('secondaryButton');
    const finish = $('finishButton');
    const snap = $('snapControl');
    const heightControls = $('heightControls');
    primary.classList.remove('hidden');
    secondary.classList.remove('hidden');
    finish.classList.add('hidden');
    snap.classList.toggle('hidden', state.phase !== 'corners');
    heightControls.classList.toggle('hidden', state.phase !== 'height');

    if (state.phase === 'source-mark') {
      primary.textContent = 'Segna sorgente';
      primary.disabled = !(state.aimPoint || state.hitPoint || state.currentPoseMatrix) || locked;
      secondary.textContent = 'Usa telefono';
      secondary.disabled = locked;
    } else if (state.phase === 'corners') {
      primary.textContent = 'Aggiungi angolo';
      primary.disabled = !state.aimPoint || locked;
      secondary.textContent = 'Annulla ultimo';
      secondary.disabled = !(room?.footprint.length) || locked;
      finish.classList.toggle('hidden', (room?.footprint.length || 0) < 3);
      finish.textContent = 'Chiudi vano';
      finish.disabled = (room?.footprint.length || 0) < 3 || locked;
    } else if (state.phase === 'height') {
      primary.textContent = 'Conferma altezza';
      primary.disabled = locked;
      secondary.textContent = 'Usa 2.70 m';
      secondary.disabled = locked;
    } else if (state.phase === 'coverage') {
      primary.textContent = 'Foto ora';
      primary.disabled = state.captureBusy || Boolean(state.captureRequest) || locked || state.completionPending;
      secondary.textContent = state.completionPending
        ? 'Salvo e completo...'
        : readiness?.ready
          ? readiness.unresolved
            ? `Completa vano · ${readiness.green}/${readiness.total} verdi`
            : 'Completa vano'
          : `Mancano ${readiness?.missing.join(' + ') || 'foto'}`;
      // A tap during an active automatic capture is accepted, but it queues
      // completion instead of changing phase while camera buffers are live.
      secondary.disabled = !readiness?.ready || state.completionPending || locked;
    } else if (state.phase === 'room-ready') {
      primary.textContent = 'Attraversa passaggio';
      primary.disabled = locked;
      secondary.textContent = state.finishArmUntil > nowMs() ? 'Conferma: termina tutto' : 'Termina intera scansione';
      secondary.disabled = locked;
    } else if (state.phase === 'transition') {
      primary.textContent = 'Sono nel nuovo vano';
      primary.disabled = !state.currentCamera || locked;
      secondary.textContent = 'Annulla passaggio';
      secondary.disabled = locked;
    } else {
      primary.classList.add('hidden');
      secondary.classList.add('hidden');
    }
  }

  function armOrFinishAcquisition() {
    if (actionsLocked() || state.phase !== 'room-ready') return;
    const currentTime = nowMs();
    if (state.finishArmUntil > currentTime) {
      state.finishArmUntil = 0;
      lockActions(350);
      finishAcquisition();
      return;
    }
    state.finishArmUntil = currentTime + CONFIG.finishArmMs;
    lockActions(700);
    updateHUD();
    const timer = setTimeout(() => {
      if (state.finishArmUntil && state.finishArmUntil <= nowMs()) {
        state.finishArmUntil = 0;
        updateHUD();
      }
    }, CONFIG.finishArmMs + 30);
    timer?.unref?.();
  }

  function primaryAction() {
    if (actionsLocked()) return;
    if (state.phase === 'source-mark') markFixedAcousticSource();
    else if (state.phase === 'corners') addCorner();
    else if (state.phase === 'height') confirmHeight(false);
    else if (state.phase === 'coverage') captureKeyframe('survey', 'manual');
    else if (state.phase === 'room-ready') {
      state.finishArmUntil = 0;
      beginTransition();
    }
    else if (state.phase === 'transition') finishTransition();
  }

  function secondaryAction() {
    if (actionsLocked()) return;
    if (state.phase === 'source-mark') {
      state.audio.sourceMode = 'monostatic';
      if ($('sourceMode')) $('sourceMode').value = 'monostatic';
      state.audio.fixedSourcePosition = null;
      beginRoom();
      updateAudioUI();
    } else if (state.phase === 'corners') undoCorner();
    else if (state.phase === 'height') confirmHeight(true);
    else if (state.phase === 'coverage') completeRoom();
    else if (state.phase === 'room-ready') armOrFinishAcquisition();
    else if (state.phase === 'transition') cancelTransition();
  }

  function finishAction() {
    if (actionsLocked()) return;
    if (state.phase === 'corners') closeRoom();
  }

  /* -----------------------------------------------------------------------
   * Plan editor, object controls and scene viewer
   * -------------------------------------------------------------------- */

  function sceneBounds2D() {
    const bounds = C.sceneBounds(state.rooms, state.objects);
    return {
      minX: bounds.min[0],
      maxX: bounds.max[0],
      minZ: bounds.min[2],
      maxZ: bounds.max[2],
    };
  }

  function planProject(point, transform) {
    return {
      x: transform.centerX + (point[0] - transform.worldCenterX) * transform.scale,
      y: transform.centerY - (point[1] - transform.worldCenterZ) * transform.scale,
    };
  }

  function planUnproject(point, transform) {
    return [
      transform.worldCenterX + (point[0] - transform.centerX) / transform.scale,
      transform.worldCenterZ - (point[1] - transform.centerY) / transform.scale,
    ];
  }

  function renderPlan() {
    const modal = $('planModal');
    if (!modal || modal.classList.contains('hidden')) return;
    const surface = canvas2D('planCanvas');
    if (!surface) return;
    const { context, width, height } = surface;
    context.clearRect(0, 0, width, height);
    const bounds = sceneBounds2D();
    const spanX = Math.max(1, bounds.maxX - bounds.minX);
    const spanZ = Math.max(1, bounds.maxZ - bounds.minZ);
    const scale = 0.78 * Math.min(width / spanX, height / spanZ);
    const transform = {
      centerX: width / 2,
      centerY: height / 2,
      worldCenterX: (bounds.minX + bounds.maxX) / 2,
      worldCenterZ: (bounds.minZ + bounds.maxZ) / 2,
      scale,
    };
    state.plan.transform = transform;

    context.lineWidth = 2;
    for (const room of state.rooms) {
      const polygon = room.model?.footprint || room.footprint;
      if (!polygon?.length) continue;
      context.beginPath();
      polygon.forEach((point, index) => {
        const projected = planProject(point, transform);
        if (index === 0) context.moveTo(projected.x, projected.y);
        else context.lineTo(projected.x, projected.y);
      });
      if (room.model) context.closePath();
      context.fillStyle = room.id === state.activeRoomId ? 'rgba(101,217,255,.14)' : 'rgba(110,160,190,.08)';
      context.strokeStyle = room.id === state.activeRoomId ? '#65d9ff' : '#7ba5bb';
      if (room.model) context.fill();
      context.stroke();
      if (room.model) {
        const label = planProject(room.model.centroid, transform);
        context.fillStyle = '#e8f8ff';
        context.font = 'bold 12px system-ui';
        context.fillText(`${room.name} | ${room.model.area.toFixed(1)} m2`, label.x + 5, label.y - 5);
      }
    }

    for (const portal of state.portals) {
      for (const side of portal.sides || []) {
        const room = state.rooms.find(item => item.id === side.roomId);
        const segment = C.portalSideSegment(room, side);
        if (!segment) continue;
        const a = planProject(segment.a, transform);
        const b = planProject(segment.b, transform);
        drawLine(context, a, b, '#ffd166', 5);
      }
    }

    for (const object of state.objects) {
      if (object.status === 'removed') continue;
      const obb = object.obb;
      const halfX = obb.extent[0] / 2;
      const halfZ = obb.extent[2] / 2;
      const cos = Math.cos(obb.yaw || 0);
      const sin = Math.sin(obb.yaw || 0);
      const corners = [[-halfX, -halfZ], [halfX, -halfZ], [halfX, halfZ], [-halfX, halfZ]].map(local => [
        obb.center[0] + cos * local[0] - sin * local[1],
        obb.center[2] + sin * local[0] + cos * local[1],
      ]).map(point => planProject(point, transform));
      context.beginPath();
      corners.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
      context.closePath();
      context.fillStyle = object.hidden ? 'rgba(180,180,180,.08)' : 'rgba(255,190,90,.22)';
      context.strokeStyle = object.kind === 'manual' ? '#ffd166' : '#f2a65a';
      context.fill();
      context.stroke();
    }

    if (state.plan.addMode && state.plan.firstPoint) {
      const point = planProject(state.plan.firstPoint, transform);
      context.fillStyle = '#62e6a5';
      context.beginPath();
      context.arc(point.x, point.y, 7, 0, Math.PI * 2);
      context.fill();
    }

    $('planStats').textContent = `${state.rooms.filter(room => room.model).length} vani | ${state.portals.length} passaggi | ${activeObjects().length} oggetti attivi${state.plan.addMode ? ' | Tocca due angoli del rettangolo oggetto' : ''}`;
  }

  function openPlan() {
    $('planModal').classList.remove('hidden');
    renderPortalControls();
    renderObjectControls();
    renderAcousticControls();
    renderPlan();
  }

  function planCanvasPoint(event) {
    const rect = $('planCanvas').getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }

  function handlePlanPointer(event) {
    if (!state.plan.transform) return;
    const world = planUnproject(planCanvasPoint(event), state.plan.transform);
    if (state.plan.addMode) {
      if (!state.plan.firstPoint) {
        state.plan.firstPoint = world;
      } else {
        const center = [(state.plan.firstPoint[0] + world[0]) / 2, (state.plan.firstPoint[1] + world[1]) / 2];
        const room = state.rooms.find(item => item.model && C.pointInPolygon(center, item.model.footprint));
        const height = C.clamp(Number($('manualHeight').value) || 0.8, 0.12, room?.model?.height || 4.0);
        const id = `O${++state.objectSequence}`;
        const object = C.createManualObject(id, $('manualName').value.trim() || `Oggetto manuale ${state.objectSequence}`, state.plan.firstPoint, world, room?.model?.floorY || 0, height);
        object.roomId = room?.id || null;
        state.objects.push(object);
        refreshAcousticSurfaces();
        state.plan.addMode = false;
        state.plan.firstPoint = null;
        $('addObject').textContent = 'Aggiungi oggetto';
        renderObjectControls();
        scheduleCheckpoint('manual-object-added');
        log('MANUAL_OBJECT_ADDED', 'INFO', { objectId: id });
      }
      renderPlan();
      return;
    }

    let best = null;
    for (const object of state.objects) {
      if (object.status === 'removed') continue;
      const distance = Math.hypot(world[0] - object.obb.center[0], world[1] - object.obb.center[2]);
      if (!best || distance < best.distance) best = { object, distance };
    }
    if (best && best.distance < Math.max(0.35, Math.max(best.object.obb.extent[0], best.object.obb.extent[2]))) {
      $('objectSelect').value = best.object.id;
      updateObjectForm();
    }
  }

  function toggleAddObject() {
    state.plan.addMode = !state.plan.addMode;
    state.plan.firstPoint = null;
    $('addObject').textContent = state.plan.addMode ? 'Annulla aggiunta' : 'Aggiungi oggetto';
    renderPlan();
  }

  function selectedObject() {
    return state.objects.find(object => String(object.id) === $('objectSelect').value) || null;
  }

  function renderObjectControls() {
    if (!$('objectSelect')) return;
    const previous = $('objectSelect').value;
    $('objectSelect').innerHTML = '<option value="">Nessun oggetto</option>' + state.objects.map(object => `<option value="${object.id}">${escapeHtml(object.name)}${object.status === 'removed' ? ' (rimosso)' : ''}</option>`).join('');
    if (state.objects.some(object => String(object.id) === previous)) $('objectSelect').value = previous;
    updateObjectForm();
  }

  function updateObjectForm() {
    const object = selectedObject();
    const disabled = !object;
    for (const id of ['objectName', 'objectLength', 'objectDepth', 'objectHeight', 'objectYaw']) $(id).disabled = disabled;
    if (!object) {
      $('objectName').value = '';
      $('objectLength').value = '';
      $('objectDepth').value = '';
      $('objectHeight').value = '';
      $('objectYaw').value = '';
      $('objectInfo').textContent = 'Seleziona un oggetto automatico o manuale.';
      return;
    }
    $('objectName').value = object.name;
    $('objectLength').value = object.obb.extent[0].toFixed(2);
    $('objectDepth').value = object.obb.extent[2].toFixed(2);
    $('objectHeight').value = object.obb.extent[1].toFixed(2);
    $('objectYaw').value = degrees(object.obb.yaw || 0).toFixed(0);
    const objectType = object.kind === 'manual' ? 'Cuboide RGB manuale' : (object.edited ? 'Voxel RGB corretto' : 'Voxel RGB multi-vista');
    $('objectInfo').textContent = `${objectType} | conf ${Math.round(object.confidence * 100)}% | ${object.points?.length || 0} punti | ${object.mesh?.triangleFaceKeys?.length || 0} triangoli etichettati`;
    $('objectHide').textContent = object.hidden ? 'Mostra' : 'Nascondi';
  }

  function applyObjectEdits() {
    const object = selectedObject();
    if (!object) return;
    object.name = $('objectName').value.trim() || object.name;
    const extent = [
      C.clamp(Number($('objectLength').value) || object.obb.extent[0], 0.08, 8),
      C.clamp(Number($('objectHeight').value) || object.obb.extent[1], 0.08, 5),
      C.clamp(Number($('objectDepth').value) || object.obb.extent[2], 0.08, 8),
    ];
    const yaw = (Number($('objectYaw').value) || 0) * Math.PI / 180;
    const previousObb = {
      center: [...object.obb.center],
      extent: [...object.obb.extent],
      yaw: object.obb.yaw || 0,
    };
    const oldBottom = previousObb.center[1] - previousObb.extent[1] / 2;
    const nextObb = {
      center: [previousObb.center[0], oldBottom + extent[1] / 2, previousObb.center[2]],
      extent,
      yaw,
    };

    // RGB evidence must remain registered to the edited occupancy. Transform
    // measured/synthetic points through normalized OBB coordinates rather than
    // leaving a colored ghost at the old pose.
    const transformed = C.transformPointsBetweenObbs(object.points || [], previousObb, nextObb);
    object.points = transformed.length
      ? transformed
      : C.boxSurfacePoints(nextObb.center, nextObb.extent, nextObb.yaw, 0.12, object.rgbSummary?.mean || [170, 180, 188]);
    object.obb = nextObb;
    if (object.kind === 'scan' && object.mesh?.vertices?.length) {
      // Preserve the measured colored voxel silhouette when dimensions or yaw
      // are corrected.  Replacing it with a cuboid would discard the shape the
      // user needs for later acoustic obstruction/scattering simulations.
      const meshPoints = object.mesh.vertices.map((point, index) => ({
        point,
        color: object.mesh.colors?.[index] || object.rgbSummary?.mean || [180, 190, 200],
      }));
      const transformedMeshPoints = C.transformPointsBetweenObbs(meshPoints, previousObb, nextObb);
      object.mesh = {
        ...object.mesh,
        vertices: transformedMeshPoints.map(item => item.point),
        colors: transformedMeshPoints.map(item => item.color),
        indices: [...(object.mesh.indices || [])],
      };
    } else {
      object.mesh = C.boxMesh(nextObb.center, nextObb.extent, nextObb.yaw);
    }
    object.mesh = C.assignMeshAcousticFaces(object.mesh, nextObb);
    object.edited = true;
    const obbVolume = extent[0] * extent[1] * extent[2];
    const occupiedVolume = object.kind === 'scan'
      ? Math.min(obbVolume, (object.points?.length || 0) * (object.shape?.voxelSize || CONFIG.objectVoxelSize) ** 3)
      : obbVolume;
    object.shape = {
      ...(object.shape || {}),
      representation: object.kind === 'scan' ? 'edited-colored-voxel-surface' : 'manual-rgb-cuboid',
      occupiedVolume,
      obbVolume,
      fillRatio: C.clamp(occupiedVolume / Math.max(1e-9, obbVolume)),
    };
    const visual = objectVisualEvidence(object);
    if (visual?.sampleCount) object.rgbSummary = { mean: [...visual.meanRgb], pointCount: object.points.length, sampleCount: visual.sampleCount };
    refreshAcousticSurfaces();
    log('OBJECT_EDITED', 'INFO', { objectId: object.id, extent, yaw, rgbPoints: object.points.length });
    renderObjectControls();
    renderPlan();
    renderScene();
    scheduleCheckpoint('object-edited');
  }

  function renderPortalControls() {
    if (!$('portalSelect')) return;
    const previous = $('portalSelect').value;
    $('portalSelect').innerHTML = '<option value="">Nessun passaggio</option>' + state.portals.map(portal => `<option value="${portal.id}">${portal.id}: ${portal.sourceRoomId} -> ${portal.targetRoomId || '?'}</option>`).join('');
    if (state.portals.some(portal => portal.id === previous)) $('portalSelect').value = previous;
    updatePortalForm();
  }

  function selectedPortal() {
    return state.portals.find(portal => portal.id === $('portalSelect').value) || null;
  }

  function updatePortalForm() {
    const portal = selectedPortal();
    $('portalWidth').disabled = !portal;
    $('portalTop').disabled = !portal;
    $('applyPortal').disabled = !portal;
    $('portalWidth').value = portal ? portal.width.toFixed(2) : '';
    $('portalTop').value = portal ? portal.top.toFixed(2) : '';
  }

  function applyPortalEdits() {
    const portal = selectedPortal();
    if (!portal) return;
    const width = C.clamp(Number($('portalWidth').value) || portal.width, 0.45, 4.5);
    portal.top = C.clamp(Number($('portalTop').value) || portal.top, 1.40, 4.5);
    portal.width = width;
    for (const side of portal.sides) {
      const room = state.rooms.find(item => item.id === side.roomId);
      const wall = room?.model?.walls?.[side.wallIndex];
      if (!wall) continue;
      const center = (side.s0 + side.s1) / 2;
      side.s0 = C.clamp(center - width / 2, 0, wall.length);
      side.s1 = C.clamp(center + width / 2, 0, wall.length);
    }
    refreshAcousticSurfaces();
    renderPlan();
    renderScene();
    scheduleCheckpoint('portal-edited');
  }


  function selectedAcousticSurface() {
    const selectedId = $('acousticSurfaceSelect')?.value || state.acoustic.selectedId;
    return state.acousticSurfaces.find(surface => surface.id === selectedId) || null;
  }

  function renderAcousticControls() {
    const select = $('acousticSurfaceSelect');
    if (!select) return;
    const previous = state.acoustic.selectedId || select.value;
    select.innerHTML = '<option value="">Nessuna superficie</option>' + state.acousticSurfaces.map(surface => (
      `<option value="${escapeHtml(surface.id)}">${escapeHtml(surface.label)} · ${surface.area.toFixed(2)} m²</option>`
    )).join('');
    if (state.acousticSurfaces.some(surface => surface.id === previous)) select.value = previous;
    else select.value = state.acousticSurfaces[0]?.id || '';
    state.acoustic.selectedId = select.value || null;

    const materialSelect = $('acousticMaterial');
    if (materialSelect && !materialSelect.dataset?.populated) {
      materialSelect.innerHTML = '<option value="auto">Auto · prior visivo V10</option>' + Object.entries(C.MATERIAL_LIBRARY).map(([key, value]) => (
        `<option value="${key}">${escapeHtml(value.label)}</option>`
      )).join('');
      if (materialSelect.dataset) materialSelect.dataset.populated = '1';
    }
    const bandSelect = $('acousticBand');
    if (bandSelect && !bandSelect.dataset?.populated) {
      bandSelect.innerHTML = C.ACOUSTIC_BANDS.map((band, index) => `<option value="${index}">${band} Hz</option>`).join('');
      if (bandSelect.dataset) bandSelect.dataset.populated = '1';
      bandSelect.value = String(state.acoustic.bandIndex);
    }
    updateAcousticForm();
    const summary = C.acousticSummary(state.rooms.filter(room => room.model), state.acousticSurfaces);
    const summaryElement = $('acousticSummary');
    if (summaryElement) {
      const rt = summary.rt60Sabine[state.acoustic.bandIndex];
      summaryElement.textContent = `${state.acousticSurfaces.length} superfici · ${summary.totalArea.toFixed(1)} m² · volume ${summary.volume.toFixed(1)} m³ · RT60 Sabine visivo ${rt == null ? 'n/d' : `${rt.toFixed(2)} s`} @ ${C.ACOUSTIC_BANDS[state.acoustic.bandIndex]} Hz`;
    }
  }

  function updateAcousticForm() {
    const surface = selectedAcousticSurface();
    state.acoustic.selectedId = surface?.id || null;
    const ids = ['acousticScope', 'acousticMaterial', 'acousticScattering', ...C.ACOUSTIC_BANDS.map(band => `alpha${band}`), 'applyAcoustic', 'resetAcoustic'];
    for (const id of ids) if ($(id)) $(id).disabled = !surface;
    if (!surface) {
      if ($('acousticInfo')) $('acousticInfo').textContent = 'Seleziona una superficie della shell o di un oggetto.';
      return;
    }
    if ($('acousticMaterial')) $('acousticMaterial').value = surface.material?.mode === 'manual' ? surface.material.key : 'auto';
    if ($('acousticScattering')) $('acousticScattering').value = Number(surface.material?.scattering ?? 0.2).toFixed(2);
    C.ACOUSTIC_BANDS.forEach((band, index) => {
      const input = $(`alpha${band}`);
      if (input) input.value = Number(surface.material?.alpha?.[index] ?? 0.2).toFixed(2);
    });
    const confidence = Math.round(100 * (surface.material?.confidence || 0));
    const source = surface.material?.source === 'user' ? 'utente' : (surface.material?.source || 'prior');
    if ($('acousticInfo')) $('acousticInfo').textContent = `${surface.role} · area ${surface.area.toFixed(2)} m² · ${surface.material?.label || 'n/d'} · conf ${confidence}% · fonte ${source}. Il prior visivo non è una misura RIR.`;
  }


  function acousticEditTargets(surface) {
    if (!surface) return [];
    const scope = $('acousticScope')?.value || 'surface';
    if (scope === 'owner') {
      if (surface.ownerType === 'object') {
        return state.acousticSurfaces.filter(candidate => candidate.ownerType === 'object' && candidate.ownerId === surface.ownerId);
      }
      if (surface.role === 'wall') {
        return state.acousticSurfaces.filter(candidate => candidate.ownerType === 'room' && candidate.roomId === surface.roomId && candidate.role === 'wall');
      }
      return [surface];
    }
    if (scope === 'similar') {
      const key = surface.material?.key || 'unknown';
      const candidates = state.acousticSurfaces.filter(candidate => (
        candidate.ownerType === surface.ownerType
        && candidate.role === surface.role
        && (candidate.material?.key || 'unknown') === key
      ));
      return candidates.length ? candidates : [surface];
    }
    return [surface];
  }

  function previewAcousticMaterial() {
    const surface = selectedAcousticSurface();
    if (!surface) return;
    const key = $('acousticMaterial').value;
    if (key === 'auto') {
      C.ACOUSTIC_BANDS.forEach((band, index) => { $(`alpha${band}`).value = Number(surface.material.alpha[index]).toFixed(2); });
      $('acousticScattering').value = Number(surface.material.scattering ?? 0.2).toFixed(2);
      return;
    }
    const material = C.materialDefinition(key);
    C.ACOUSTIC_BANDS.forEach((band, index) => { $(`alpha${band}`).value = Number(material.alpha[index]).toFixed(2); });
    $('acousticScattering').value = Number(material.scattering).toFixed(2);
  }

  function applyAcousticEdits() {
    let surface = selectedAcousticSurface();
    if (!surface) return;
    const selectedId = surface.id;
    const requested = $('acousticMaterial').value;
    const targets = acousticEditTargets(surface);
    if (requested === 'auto') {
      for (const target of targets) target.material.mode = 'auto';
      refreshAcousticSurfaces();
      surface = state.acousticSurfaces.find(item => item.id === selectedId) || surface;
    } else {
      const alpha = C.ACOUSTIC_BANDS.map((band, index) => {
        const parsed = Number($(`alpha${band}`).value);
        return C.clamp(Number.isFinite(parsed) ? parsed : surface.material.alpha[index], 0, 1);
      });
      const parsedScattering = Number($('acousticScattering').value);
      const scattering = C.clamp(Number.isFinite(parsedScattering) ? parsedScattering : surface.material.scattering, 0, 1);
      for (const target of targets) C.applyMaterialToSurface(target, requested, { mode: 'manual', alpha, scattering });
      renderAcousticControls();
    }
    state.acoustic.selectedId = selectedId;
    renderScene();
    renderReview();
    scheduleCheckpoint('acoustic-surface-edited');
    log('ACOUSTIC_SURFACE_EDITED', 'INFO', {
      surfaceId: surface.id,
      affected: targets.length,
      scope: $('acousticScope')?.value || 'surface',
      material: surface.material.key,
      mode: surface.material.mode,
    });
  }

  function resetAcousticAuto() {
    const surface = selectedAcousticSurface();
    if (!surface) return;
    const selectedId = surface.id;
    const targets = acousticEditTargets(surface);
    for (const target of targets) target.material.mode = 'auto';
    refreshAcousticSurfaces();
    state.acoustic.selectedId = selectedId;
    renderAcousticControls();
    renderScene();
    scheduleCheckpoint('acoustic-surface-auto');
    log('ACOUSTIC_SURFACE_AUTO_RESTORED', 'INFO', { selectedId, affected: targets.length, scope: $('acousticScope')?.value || 'surface' });
  }

  function orthoProject(point, center, scale) {
    const x = point[0] - center[0];
    const y = point[1] - center[1];
    const z = point[2] - center[2];
    const cy = Math.cos(state.viewer.yaw);
    const sy = Math.sin(state.viewer.yaw);
    const cp = Math.cos(state.viewer.pitch);
    const sp = Math.sin(state.viewer.pitch);
    const rotatedX = cy * x - sy * z;
    const rotatedZ = sy * x + cy * z;
    const projectedY = cp * y - sp * rotatedZ;
    const depth = sp * y + cp * rotatedZ;
    return [rotatedX * scale, projectedY * scale, depth];
  }

  function textureImage(key) {
    const texture = state.wallTextures[key];
    if (!texture?.dataUrl) return null;
    if (state.textureImages[key]) return state.textureImages[key];
    const image = new Image();
    image.onload = () => {
      image.onload = null;
      renderScene();
    };
    image.onerror = () => {
      delete state.textureImages[key];
      image.onload = null;
      image.onerror = null;
    };
    image.src = texture.dataUrl;
    state.textureImages[key] = image;
    return image.complete ? image : null;
  }

  function drawImageTriangle(context, image, sourceA, sourceB, sourceC, destinationA, destinationB, destinationC) {
    const denominator = sourceA.x * (sourceB.y - sourceC.y) + sourceB.x * (sourceC.y - sourceA.y) + sourceC.x * (sourceA.y - sourceB.y);
    if (Math.abs(denominator) < 1e-8) return;
    const a = (destinationA.x * (sourceB.y - sourceC.y) + destinationB.x * (sourceC.y - sourceA.y) + destinationC.x * (sourceA.y - sourceB.y)) / denominator;
    const b = (destinationA.y * (sourceB.y - sourceC.y) + destinationB.y * (sourceC.y - sourceA.y) + destinationC.y * (sourceA.y - sourceB.y)) / denominator;
    const c = (destinationA.x * (sourceC.x - sourceB.x) + destinationB.x * (sourceA.x - sourceC.x) + destinationC.x * (sourceB.x - sourceA.x)) / denominator;
    const d = (destinationA.y * (sourceC.x - sourceB.x) + destinationB.y * (sourceA.x - sourceC.x) + destinationC.y * (sourceB.x - sourceA.x)) / denominator;
    const e = (destinationA.x * (sourceB.x * sourceC.y - sourceC.x * sourceB.y) + destinationB.x * (sourceC.x * sourceA.y - sourceA.x * sourceC.y) + destinationC.x * (sourceA.x * sourceB.y - sourceB.x * sourceA.y)) / denominator;
    const f = (destinationA.y * (sourceB.x * sourceC.y - sourceC.x * sourceB.y) + destinationB.y * (sourceC.x * sourceA.y - sourceA.x * sourceC.y) + destinationC.y * (sourceA.x * sourceB.y - sourceB.x * sourceA.y)) / denominator;
    context.save();
    context.beginPath();
    context.moveTo(destinationA.x, destinationA.y);
    context.lineTo(destinationB.x, destinationB.y);
    context.lineTo(destinationC.x, destinationC.y);
    context.closePath();
    context.clip();
    context.transform(a, b, c, d, e, f);
    context.drawImage(image, 0, 0);
    context.restore();
  }

  function drawWallTexture(context, convert, room, wall) {
    const key = `${room.id}:${wall.index}`;
    const image = textureImage(key);
    if (!image) return;
    const a = convert([wall.a[0], room.model.floorY, wall.a[1]]);
    const b = convert([wall.b[0], room.model.floorY, wall.b[1]]);
    const c = convert([wall.b[0], room.model.ceilingY, wall.b[1]]);
    const d = convert([wall.a[0], room.model.ceilingY, wall.a[1]]);
    const sourceA = { x: 0, y: image.height };
    const sourceB = { x: image.width, y: image.height };
    const sourceC = { x: image.width, y: 0 };
    const sourceD = { x: 0, y: 0 };
    drawImageTriangle(context, image, sourceA, sourceB, sourceC, a, b, c);
    drawImageTriangle(context, image, sourceA, sourceC, sourceD, a, c, d);
  }


  function drawMetricGaussianLayer(context, center, scale, width, height) {
    if (!$('layerGaussians')?.checked || $('bareRoom')?.checked || !state.geometryGaussians.length) return;
    const maximum = Math.min(5200, state.geometryGaussians.length);
    const step = Math.max(1, Math.ceil(state.geometryGaussians.length / maximum));
    const projected = [];
    for (let index = 0; index < state.geometryGaussians.length; index += step) {
      const gaussian = state.geometryGaussians[index];
      if (!gaussian?.center) continue;
      const view = orthoProject(gaussian.center, center, scale);
      projected.push({
        x: width / 2 + state.viewer.pan[0] + view[0],
        y: height / 2 + state.viewer.pan[1] - view[1],
        depth: view[2],
        radiusX: C.clamp((gaussian.sigma?.[0] || 0.10) * scale, 0.8, 7),
        radiusY: C.clamp((gaussian.sigma?.[1] || 0.10) * scale, 0.8, 7),
        color: gaussian.color || [128, 150, 162],
        opacity: C.clamp((gaussian.opacity || 0.4) * 0.62, 0.14, 0.58),
        confidence: gaussian.geometryConfidence || 0.3,
      });
    }
    projected.sort((a, b) => b.depth - a.depth);
    context.save();
    for (const point of projected) {
      const color = point.color.map(value => C.clamp(Math.round(value), 0, 255));
      context.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${point.opacity})`;
      context.beginPath();
      context.ellipse(point.x, point.y, point.radiusX, point.radiusY, 0, 0, Math.PI * 2);
      context.fill();
      if (point.confidence > 0.62) {
        context.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},0.42)`;
        context.lineWidth = 0.45;
        context.stroke();
      }
    }
    context.restore();
  }

  function drawAcousticSceneLayer(context, convert, center, scale) {
    if (!$('layerAcoustic')?.checked || $('bareRoom')?.checked) return;
    const bandIndex = C.clamp(Number($('acousticBand')?.value ?? state.acoustic.bandIndex), 0, C.ACOUSTIC_BANDS.length - 1);
    state.acoustic.bandIndex = bandIndex;
    const surfaces = state.acousticSurfaces.map(surface => {
      const depth = surface.vertices.reduce((sum, vertex) => sum + orthoProject(vertex, center, scale)[2], 0) / Math.max(1, surface.vertices.length);
      return { surface, depth };
    }).sort((a, b) => b.depth - a.depth);
    for (const item of surfaces) {
      const surface = item.surface;
      if (!surface.vertices?.length) continue;
      if (surface.ownerType === 'object') {
        const owner = state.objects.find(object => object.id === surface.ownerId);
        if (!owner || owner.status === 'removed' || owner.hidden) continue;
      }
      const alpha = C.clamp(surface.material?.alpha?.[bandIndex] ?? 0.2);
      const rgb = C.acousticColor(alpha);
      const projected = surface.vertices.map(convert);
      context.save();
      context.beginPath();
      projected.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
      context.closePath();
      context.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.28)`;
      context.fill();
      context.strokeStyle = surface.id === state.acoustic.selectedId ? '#ffffff' : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.86)`;
      context.lineWidth = surface.id === state.acoustic.selectedId ? 2.4 : 0.8;
      context.stroke();
      context.restore();
    }
  }

  function drawObjectApproximateShape(context, convert, object) {
    if (!$('layerObjectShape')?.checked) return;
    const mesh = object.mesh?.vertices?.length ? object.mesh : C.boxMesh(object.obb.center, object.obb.extent, object.obb.yaw);
    const mean = object.rgbSummary?.mean || [180, 165, 145];
    context.save();
    context.lineWidth = 0.65;
    for (let index = 0; index < mesh.indices.length; index += 3) {
      const ia = mesh.indices[index];
      const ib = mesh.indices[index + 1];
      const ic = mesh.indices[index + 2];
      const a = convert(mesh.vertices[ia]);
      const b = convert(mesh.vertices[ib]);
      const c = convert(mesh.vertices[ic]);
      const colors = [mesh.colors?.[ia], mesh.colors?.[ib], mesh.colors?.[ic]].filter(Boolean);
      const triangleColor = colors.length
        ? [0, 1, 2].map(channel => Math.round(colors.reduce((sum, color) => sum + color[channel], 0) / colors.length))
        : mean;
      context.fillStyle = `rgba(${triangleColor[0]},${triangleColor[1]},${triangleColor[2]},${object.kind === 'scan' ? 0.23 : 0.28})`;
      context.strokeStyle = `rgba(${triangleColor[0]},${triangleColor[1]},${triangleColor[2]},0.64)`;
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.lineTo(c.x, c.y);
      context.closePath();
      context.fill();
      context.stroke();
    }
    context.restore();
  }

  function drawRgbObjectPoints(context, object, center, scale, width, height) {
    if (!$('layerObjects')?.checked || !object.points?.length) return;
    const step = Math.max(1, Math.ceil(object.points.length / CONFIG.viewerMaxRgbPoints));
    const projected = [];
    for (let index = 0; index < object.points.length; index += step) {
      const item = object.points[index];
      const view = orthoProject(item.point, center, scale);
      projected.push({
        x: width / 2 + state.viewer.pan[0] + view[0],
        y: height / 2 + state.viewer.pan[1] - view[1],
        depth: view[2],
        color: item.color || [180, 190, 200],
        confidence: item.synthetic
          ? 0.62
          : Math.min(1, 0.45 + 0.13 * (item.xrCount || 0) + 0.09 * (item.deepCount || 0)),
      });
    }
    projected.sort((a, b) => b.depth - a.depth);
    const voxelSize = object.shape?.voxelSize || CONFIG.objectVoxelSize;
    const radius = C.clamp(voxelSize * scale * 0.34, CONFIG.viewerPointRadiusMin, CONFIG.viewerPointRadiusMax);
    context.save();
    for (const point of projected) {
      const color = point.color.map(value => C.clamp(Math.round(value), 0, 255));
      context.globalAlpha = point.confidence;
      context.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
      context.fillRect(point.x - radius, point.y - radius, 2 * radius, 2 * radius);
    }
    context.globalAlpha = 1;
    context.restore();
  }

  function renderScene() {
    const modal = $('sceneModal');
    if (!modal || modal.classList.contains('hidden')) {
      state.viewer.looping = false;
      return;
    }
    const surface = canvas2D('sceneCanvas');
    if (!surface) return;
    const { context, width, height } = surface;
    context.clearRect(0, 0, width, height);
    const rooms = state.rooms.filter(room => room.model);
    const objects = activeObjects().filter(object => !object.hidden);
    const bounds = C.sceneBounds(rooms, objects);
    const center = state.viewer.focus || [0, 1, 2].map(axis => (bounds.min[axis] + bounds.max[axis]) / 2);
    const span = Math.max(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2], 1);
    const scale = 0.72 * Math.min(width, height) / span * state.viewer.zoom;
    const convert = point => {
      const projected = orthoProject(point, center, scale);
      return { x: width / 2 + state.viewer.pan[0] + projected[0], y: height / 2 + state.viewer.pan[1] - projected[1] };
    };

    if ($('layerRoom').checked) {
      for (const room of rooms) {
        if ($('layerTexture').checked) {
          for (const wall of room.model.walls) drawWallTexture(context, convert, room, wall);
        }
        const mesh = C.roomShellMesh(room, state.portals);
        context.strokeStyle = '#65d9ff';
        context.lineWidth = 1;
        for (let index = 0; index < mesh.indices.length; index += 3) {
          const a = convert(mesh.vertices[mesh.indices[index]]);
          const b = convert(mesh.vertices[mesh.indices[index + 1]]);
          const c = convert(mesh.vertices[mesh.indices[index + 2]]);
          context.beginPath();
          context.moveTo(a.x, a.y);
          context.lineTo(b.x, b.y);
          context.lineTo(c.x, c.y);
          context.closePath();
          context.stroke();
        }
      }
    }

    drawMetricGaussianLayer(context, center, scale, width, height);
    drawAcousticSceneLayer(context, convert, center, scale);

    if (($('layerObjects').checked || $('layerObjectShape')?.checked || $('layerBoxes').checked) && !$('bareRoom').checked) {
      for (const object of objects) {
        drawObjectApproximateShape(context, convert, object);
        drawRgbObjectPoints(context, object, center, scale, width, height);
        if ($('layerBoxes').checked || object.kind === 'manual') {
          const mesh = C.boxMesh(object.obb.center, object.obb.extent, object.obb.yaw);
          context.save();
          context.strokeStyle = object.kind === 'manual' ? '#ffd166' : '#f2a65a';
          context.lineWidth = object.edited ? 1.8 : 1;
          context.setLineDash(object.kind === 'scan' ? [4, 3] : []);
          for (let index = 0; index < mesh.indices.length; index += 3) {
            const a = convert(mesh.vertices[mesh.indices[index]]);
            const b = convert(mesh.vertices[mesh.indices[index + 1]]);
            const c = convert(mesh.vertices[mesh.indices[index + 2]]);
            context.beginPath();
            context.moveTo(a.x, a.y);
            context.lineTo(b.x, b.y);
            context.lineTo(c.x, c.y);
            context.closePath();
            context.stroke();
          }
          context.restore();
        }
      }
    }

    if (!state.viewer.looping) {
      state.viewer.looping = true;
      requestAnimationFrame(sceneLoop);
    }
  }

  function sceneLoop() {
    if ($('sceneModal').classList.contains('hidden')) {
      state.viewer.looping = false;
      return;
    }
    state.viewer.looping = false;
    renderScene();
  }

  function openScene() {
    $('sceneModal').classList.remove('hidden');
    renderObjectControls();
    renderAcousticControls();
    renderScene();
  }

  /* -----------------------------------------------------------------------
   * Review and exports
   * -------------------------------------------------------------------- */

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character]);
  }

  function openReview() {
    $('reviewModal').classList.remove('hidden');
    renderReview();
  }

  function renderReview() {
    if (!$('roomsReview')) return;
    $('roomsReview').innerHTML = state.rooms.length
      ? state.rooms.map(room => {
        const targetStats = room.model ? C.photoTargetStats(ensureRoomPhotoTargets(room)) : null;
        const targetLine = targetStats
          ? ` | caselle ${targetStats.green}/${targetStats.total} verdi, ${targetStats.yellow} gialle, ${targetStats.red} rosse`
          : '';
        return `<div class="reviewCard"><b>${escapeHtml(room.name)}</b><span>${room.model ? `${room.model.area.toFixed(2)} m2 | H ${room.model.height.toFixed(2)} m | ${room.model.walls.length} pareti` : room.status}</span><span>${roomFrames(room.id).length} foto | ${room.viewClusters.length} posizioni${targetLine}</span></div>`;
      }).join('')
      : '<span class="small">Nessun vano.</span>';
    $('framesReview').innerHTML = state.frames.length
      ? state.frames.map(frame => `<div class="frameRow"><img src="${frame.jpegDataUrl}" alt=""><div><b>${frame.roomId} | ${frame.captureMode}</b><span>Q ${Math.round(frame.quality * 100)}% | ${frame.status}${frame.depthFit ? ` | errore scala ${frame.depthFit.medianError.toFixed(2)} m` : ''}</span><span>${frame.deepClass ? `wall ${frame.deepClass.structural} | obj ${frame.deepClass.objects} | optical ${frame.deepClass.optical}` : `XR depth ${Math.round((frame.depthGrid?.coverage || 0) * 100)}%`}</span></div></div>`).join('')
      : '<span class="small">Nessuna foto.</span>';
    $('objectsReview').innerHTML = state.objects.length
      ? state.objects.map(object => `<div class="reviewCard"><b>${escapeHtml(object.name)}</b><span>${object.kind} | ${object.obb.extent.map(value => value.toFixed(2)).join(' x ')} m | ${object.status}</span><span>${object.points?.length || 0} punti ${object.kind === 'scan' ? 'RGB acquisiti' : 'RGB sintetici'} | riempimento ${Math.round(100 * (object.shape?.fillRatio || 0))}%</span></div>`).join('')
      : '<span class="small">Nessun oggetto. Puoi aggiungere cuboidi dalla mappa.</span>';
    if ($('metricReview')) {
      const fitValues = state.rooms.filter(room => room.model).map(room => room.geometryFit?.meanConfidence || 0);
      const meanFit = fitValues.length ? fitValues.reduce((sum, value) => sum + value, 0) / fitValues.length : 0;
      const statistics = state.surfelMap.statistics();
      $('metricReview').innerHTML = `<div class="reviewCard"><b>Mappa metrica ibrida</b><span>${statistics.surfels} surfel · ${state.geometryGaussians.length} Gaussiane · ${state.metricPath.length} pose XR</span><span>Fit vincolato medio ${Math.round(100 * meanFit)}% · voxel ${(100 * statistics.voxelSize).toFixed(0)} cm · scala WebXR preservata</span></div>`;
    }
    if ($('acousticReview')) {
      const summary = C.acousticSummary(state.rooms.filter(room => room.model), state.acousticSurfaces);
      const successfulRirs = state.rirAnalyses.filter(item => item.ok).length;
      const meanInferenceConfidence = state.acousticInference?.zones?.length
        ? state.acousticInference.zones.reduce((sum, zone) => sum + S.median(zone.confidence || [0]), 0) / state.acousticInference.zones.length
        : 0;
      $('acousticReview').innerHTML = state.acousticSurfaces.length
        ? `<div class="reviewCard"><b>${state.acousticSurfaces.length} superfici acustiche · ${successfulRirs}/${state.rirAnalyses.length || state.audio.manifests.length} RIR valide</b><span>${summary.totalArea.toFixed(1)} m² | volume ${summary.volume.toFixed(1)} m³ | ${summary.inferredCount || 0} superfici inferite</span><span>Confidenza media zone ${Math.round(100 * meanInferenceConfidence)}% · i coefficienti non inferiti restano prior visivi o modifiche utente.</span></div>` + state.acousticSurfaces.slice(0, 80).map(surface => `<div class="reviewCard"><b>${escapeHtml(surface.label)}</b><span>${escapeHtml(surface.material.label || surface.material.key || 'materiale')} | ${surface.area.toFixed(2)} m² | ${surface.material.mode}${surface.material.confidence != null ? ` | conf. ${Math.round(100 * surface.material.confidence)}%` : ''}</span></div>`).join('')
        : '<span class="small">Le superfici acustiche saranno create appena esiste una shell metrica.</span>';
    }
  }

  function updateLandingSummary() {
    if (!$('landingSummary')) return;
    const rooms = state.rooms.filter(room => room.model).length;
    const rirCount = state.rirAnalyses.filter(item => item.ok).length || state.audio.manifests.length;
    $('landingSummary').textContent = rooms
      ? `${rooms} vani | ${state.frames.length} foto | ${state.surfelMap.map.size} surfel | ${state.objects.length} oggetti | ${rirCount} RIR | ${state.acousticSurfaces.length} superfici | stato ${state.phase}`
      : 'Nessuna scansione in memoria.';
  }

  function download(name, content, type = 'text/plain') {
    const anchor = document.createElement('a');
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function serializeDepthGrid(grid) {
    return grid ? { width: grid.width, height: grid.height, coverage: grid.coverage, data: Array.from(grid.data) } : null;
  }

  function serializeMask(mask) {
    return mask ? { width: mask.width, height: mask.height, data: Array.from(mask.data) } : null;
  }

  function serializeObjectVoxels(checkpoint) {
    const entries = [...state.objectVoxels.entries()];
    // A navigation checkpoint must remain small enough for mobile IndexedDB,
    // but it still preserves the strongest sparse XR/Deep evidence so object
    // processing after a restore is not forced to start from zero.
    const selected = checkpoint && entries.length > 6000
      ? entries.sort((a, b) => {
        const score = voxel => (voxel.viewIds?.size || 0) * 2
          + (voxel.xrCount || 0) * 0.7
          + (voxel.deepCount || 0) * 0.5
          + Math.min(2, voxel.weight || 0);
        return score(b[1]) - score(a[1]);
      }).slice(0, 6000)
      : entries;
    return selected.map(([key, voxel]) => [key, {
      ...voxel,
      point: [...(voxel.point || [0, 0, 0])],
      color: [...(voxel.color || [180, 190, 200])],
      viewIds: [...(voxel.viewIds || [])],
      roomIds: [...(voxel.roomIds || [])],
    }]);
  }

  function decimateOrderedRecords(records, maximum) {
    const source = Array.from(records || []);
    if (!maximum || source.length <= maximum) return source.map(item => ({
      ...item,
      p: item.p ? [...item.p] : item.p,
      q: item.q ? [...item.q] : item.q,
    }));
    const output = [];
    const step = (source.length - 1) / Math.max(1, maximum - 1);
    let previous = -1;
    for (let index = 0; index < maximum; index += 1) {
      const sourceIndex = Math.min(source.length - 1, Math.round(index * step));
      if (sourceIndex === previous) continue;
      previous = sourceIndex;
      const item = source[sourceIndex];
      output.push({ ...item, p: item.p ? [...item.p] : item.p, q: item.q ? [...item.q] : item.q });
    }
    return output;
  }

  function serializeMetricSurfelMap(checkpoint) {
    const maximum = checkpoint ? 12000 : state.surfelMap.maxSurfels;
    let surfels = state.surfelMap.values();
    if (surfelCountNeedsRanking(surfels.length, maximum)) {
      surfels = surfels
        .slice()
        .sort((a, b) => {
          const score = item => Math.log1p(item.weight || 0)
            + 0.32 * Object.keys(item.viewIds || {}).length
            + 0.16 * Object.keys(item.sources || {}).length
            + 0.0002 * (item.lastSequence || 0);
          return score(b) - score(a);
        })
        .slice(0, maximum);
    }
    return {
      schema: 'room-scanner-metric-surfel-map-v1',
      voxelSize: state.surfelMap.voxelSize,
      maxSurfels: state.surfelMap.maxSurfels,
      statistics: state.surfelMap.statistics(),
      surfels: surfels.map(surfel => ({
        ...surfel,
        position: [...surfel.position],
        normal: [...surfel.normal],
        color: surfel.color.map(value => Math.round(value)),
        viewIds: { ...(surfel.viewIds || {}) },
        roomIds: { ...(surfel.roomIds || {}) },
        sources: { ...(surfel.sources || {}) },
        surfaceVotes: { ...(surfel.surfaceVotes || {}) },
      })),
      compactedForCheckpoint: checkpoint && state.surfelMap.map.size > maximum,
    };
  }

  function surfelCountNeedsRanking(count, maximum) {
    return Number.isFinite(maximum) && maximum > 0 && count > maximum;
  }

  function compactAcousticZonesForSnapshot(checkpoint) {
    const zones = state.acousticZones || { primary: [], gaussians: [], all: [] };
    const gaussians = checkpoint ? (zones.gaussians || []).slice(0, 1200) : (zones.gaussians || []);
    return {
      schema: zones.schema || 'room-scanner-acoustic-zones-v2',
      generatedAt: zones.generatedAt || null,
      primary: zones.primary || [],
      gaussians,
      all: [...(zones.primary || []), ...gaussians],
      compactedForCheckpoint: checkpoint && (zones.gaussians || []).length > gaussians.length,
    };
  }

  function serializeAudioCaptureState() {
    const controllerSummary = state.audioController?.summary?.() || null;
    return {
      enabled: Boolean(state.audio.enabled),
      sourceMode: state.audio.sourceMode,
      fixedSourcePosition: state.audio.fixedSourcePosition ? [...state.audio.fixedSourcePosition] : null,
      settings: { ...(state.audio.settings || {}) },
      capabilities: { ...(state.audio.capabilities || {}) },
      contextCreation: { ...(state.audio.contextCreation || {}) },
      manifests: (state.audio.manifests || []).map(manifest => ({ ...manifest })),
      roomSweepCounts: { ...(state.audio.roomSweepCounts || {}) },
      lastSweepPosition: state.audio.lastSweepPosition ? [...state.audio.lastSweepPosition] : null,
      lastSweepYaw: state.audio.lastSweepYaw,
      controllerSummary,
      storage: {
        database: AudioCapture.DB_NAME,
        store: AudioCapture.STORE_NAME,
        policy: 'raw PCM Int16 is stored separately in IndexedDB and is never embedded in checkpoints',
      },
    };
  }

  function serializeCornerRecord(corner) {
    if (Array.isArray(corner)) return [...corner];
    if (!corner || typeof corner !== 'object') return corner;
    return {
      ...corner,
      point: Array.isArray(corner.point) ? [...corner.point] : corner.point,
      raw: Array.isArray(corner.raw) ? [...corner.raw] : corner.raw,
    };
  }

  function restoreCornerRecord(corner) {
    if (Array.isArray(corner)) {
      const point = [...corner];
      return { point, raw: [...point], jitter: null, stable: false, snapped: false, capturedAt: null, anchorIndex: null };
    }
    if (!corner || typeof corner !== 'object') return corner;
    return {
      ...corner,
      point: Array.isArray(corner.point) ? [...corner.point] : null,
      raw: Array.isArray(corner.raw) ? [...corner.raw] : (Array.isArray(corner.point) ? [...corner.point] : null),
    };
  }

  function buildRawSnapshot(options = {}) {
    const checkpoint = Boolean(options.checkpoint);
    const metricPathMaximum = checkpoint ? 8000 : CONFIG.metricPathMaxSamples;
    const gaussianMaximum = checkpoint ? 3500 : CONFIG.geometryGaussianMaxCount;
    return {
      schema: RAW_SCHEMA,
      version: VERSION,
      revision: REVISION,
      createdAt: nowIso(),
      checkpoint,
      phase: state.phase,
      activeRoomId: state.activeRoomId,
      coordinateSystem: {
        frame: 'single WebXR local-floor reference space',
        units: 'metres',
        scaleAuthority: 'WebXR poses and XR depth; Deep depth is calibrated per frame',
      },
      rooms: state.rooms.map(room => ({
        id: room.id,
        name: room.name,
        status: room.status,
        footprint: room.footprint?.map(point => [...point]) || [],
        acquisitionFootprint: (room.acquisitionFootprint || room.footprint || []).map(point => [...point]),
        corners: (room.corners || []).map(serializeCornerRecord),
        floorY: room.model?.floorY ?? 0,
        height: room.height,
        acquisitionHeight: room.acquisitionHeight || room.height,
        geometryFit: room.geometryFit || null,
        coverage: Array.from(room.coverage?.values || []),
        photoTargets: (room.photoTargets || []).map(target => ({
          ...target,
          observations: (target.observations || []).map(observation => ({ ...observation })),
        })),
        captureSummary: room.captureSummary || null,
        viewClusters: room.viewClusters || [],
        frameIds: room.frameIds || [],
        createdAt: room.createdAt,
        completedAt: room.completedAt,
      })),
      portals: state.portals,
      frames: state.frames.map(frame => ({
        ...frame,
        rgba: null,
        deep: null,
        jpegDataUrl: checkpoint && options.separateFrameImages ? null : frame.jpegDataUrl,
        checkpointPhotoKey: checkpoint && options.separateFrameImages && (frame.jpegDataUrl || frame.checkpointPhotoKey)
          ? checkpointPhotoKey(frame.id)
          : (frame.checkpointPhotoKey || null),
        depthGrid: serializeDepthGrid(frame.depthGrid),
        deepMask: serializeMask(frame.deepMask),
      })),
      metricGeometry: {
        surfelMap: serializeMetricSurfelMap(checkpoint),
        posePath: decimateOrderedRecords(state.metricPath, metricPathMaximum),
        posePathOriginalSamples: state.metricPath.length,
        gaussians: (state.geometryGaussians || []).slice(0, gaussianMaximum),
        gaussiansOriginalCount: state.geometryGaussians.length,
        fitResults: state.geometryFitResults || [],
        algorithm: 'bounded-hybrid-webxr-depth-anything-surfel-fit-v20-1',
      },
      objectVoxels: serializeObjectVoxels(checkpoint),
      // Checkpoints prioritize safe recovery on mobile. Extremely dense point
      // clouds are capped there; explicit RAW export keeps every point.
      objects: checkpoint
        ? state.objects.map(object => ({
          ...object,
          points: object.points?.length > 4000 ? object.points.slice(0, 4000) : object.points,
          // A dense voxel mesh is regenerable from points and can dominate the
          // structured-clone cost of an emergency checkpoint.
          mesh: object.kind === 'scan' && object.mesh?.vertices?.length > 12000 ? null : object.mesh,
        }))
        : state.objects,
      // Wall JPEG atlases are derived products. They are kept in explicit RAW
      // exports but stripped from automatic checkpoints to prevent multi-MB
      // base64 strings from causing a mobile tab eviction.
      wallTextures: checkpoint
        ? Object.fromEntries(Object.entries(state.wallTextures).map(([key, texture]) => [key, {
          ...texture,
          dataUrl: null,
          omittedFromCheckpoint: Boolean(texture?.dataUrl),
        }]))
        : state.wallTextures,
      surfaceVisualEvidence: state.surfaceVisualEvidence,
      acousticSurfaces: state.acousticSurfaces,
      acousticSettings: { ...state.acoustic },
      acousticZones: compactAcousticZonesForSnapshot(checkpoint),
      acousticInference: state.acousticInference,
      rirAnalyses: state.rirAnalyses,
      audioCapture: serializeAudioCaptureState(),
      acousticSummary: C.acousticSummary(state.rooms.filter(room => room.model), state.acousticSurfaces),
      checkpointPolicy: checkpoint ? {
        compact: true,
        frameImages: 'separate-indexeddb-records',
        acousticPcm: 'separate-indexeddb-records',
        metricPoseLimit: metricPathMaximum,
        metricSurfelLimit: 12000,
        gaussianLimit: gaussianMaximum,
        acousticGaussianZoneLimit: 1200,
        objectVoxelLimit: 6000,
        objectPointLimit: 4000,
        wallTextureDataUrls: 'omitted-regenerable',
      } : null,
      logs: checkpoint ? state.logs.slice(0, 80) : state.logs,
    };
  }

  function exportRaw() {
    const raw = buildRawSnapshot();
    download(`room_scan_v20_1_${Date.now()}.json`, JSON.stringify(raw), 'application/json');
  }

  function applyRawSnapshot(raw, options = {}) {
    if (raw?.schema !== RAW_SCHEMA && !LEGACY_RAW_SCHEMAS.has(raw?.schema)) throw new Error(`Schema incompatibile: ${raw?.schema}`);
    const migratedLegacy = LEGACY_RAW_SCHEMAS.has(raw?.schema);
    const roomsNeedingTargetRebuild = new Set();

    // Stop any idle microphone graph before replacing its capture manifest.
    // The operation is asynchronous by browser design but no imported state
    // retains a reference to the old controller.
    if (state.audioController) {
      try {
        state.audioController.freezeScheduling?.();
        state.audioController.stop?.({ flush: false, persist: false }).catch?.(() => {});
      } catch {}
      state.audioController = null;
    }

    state.rooms = (raw.rooms || []).map(room => {
      const floorY = Number.isFinite(room.floorY) ? room.floorY : 0;
      const model = room.footprint?.length >= 3
        ? C.buildRoomModel(room.footprint, floorY, room.height || CONFIG.defaultHeight)
        : null;
      const photoTargets = Array.isArray(room.photoTargets)
        ? room.photoTargets.map(target => ({
          ...target,
          observations: Array.isArray(target.observations)
            ? target.observations.map(observation => ({ ...observation }))
            : [],
        }))
        : [];
      if (model && !photoTargets.length) roomsNeedingTargetRebuild.add(room.id);
      return {
        ...room,
        footprint: room.footprint?.map(point => [...point]) || [],
        acquisitionFootprint: (room.acquisitionFootprint || room.footprint || []).map(point => [...point]),
        corners: (room.corners || []).map(restoreCornerRecord),
        acquisitionHeight: room.acquisitionHeight || room.height || CONFIG.defaultHeight,
        model,
        fittedModel: model,
        geometryFit: room.geometryFit || null,
        coverage: {
          count: room.coverage?.length || CONFIG.coverageBins,
          values: Float32Array.from(room.coverage || []),
        },
        photoTargets,
        captureSummary: room.captureSummary || null,
        viewClusters: room.viewClusters || [],
        frameIds: room.frameIds || [],
      };
    });
    state.portals = raw.portals || [];
    state.frames = (raw.frames || []).map(frame => ({
      ...frame,
      rgba: null,
      deep: null,
      depthGrid: frame.depthGrid ? { ...frame.depthGrid, data: Float32Array.from(frame.depthGrid.data) } : null,
      deepMask: frame.deepMask ? { ...frame.deepMask, data: Uint8Array.from(frame.deepMask.data) } : null,
    }));
    state.checkpointPhotoIds = (options.restored || options.handoff)
      ? new Set(state.frames.filter(frame => frame.jpegDataUrl && frame.checkpointPhotoKey).map(frame => String(frame.id)))
      : new Set();
    for (const room of state.rooms) {
      if (!room.model) continue;
      ensureRoomPhotoTargets(room);
      if (roomsNeedingTargetRebuild.has(room.id)) {
        for (const frame of state.frames.filter(item => item.roomId === room.id)) {
          C.registerFramePhotoTargets(room.photoTargets, frame, { minimumScore: CONFIG.photoTargetMinScore });
        }
      }
      if (!room.frameIds.length) room.frameIds = state.frames.filter(frame => frame.roomId === room.id).map(frame => frame.id);
      if (!room.viewClusters.length) room.viewClusters = [...new Set(state.frames.filter(frame => frame.roomId === room.id).map(frame => frame.viewCluster))];
    }

    const metricGeometry = raw.metricGeometry || {};
    state.surfelMap = metricGeometry.surfelMap
      ? G.MetricSurfelMap.deserialize(metricGeometry.surfelMap, {
        voxelSize: CONFIG.surfelVoxelSize,
        maxSurfels: CONFIG.surfelMaxCount,
      })
      : new G.MetricSurfelMap({ voxelSize: CONFIG.surfelVoxelSize, maxSurfels: CONFIG.surfelMaxCount });
    state.metricPath = (metricGeometry.posePath || []).map(pose => ({
      ...pose,
      p: pose.p ? [...pose.p] : null,
      q: pose.q ? [...pose.q] : null,
    })).filter(pose => Number.isFinite(pose.t) && pose.p?.length >= 3);
    state.lastMetricPathTime = state.metricPath.at(-1)?.t ?? -Infinity;
    state.geometryGaussians = (metricGeometry.gaussians || []).map(gaussian => ({
      ...gaussian,
      center: [...(gaussian.center || [0, 0, 0])],
      normal: [...(gaussian.normal || [0, 1, 0])],
      tangent: gaussian.tangent ? [...gaussian.tangent] : gaussian.tangent,
      bitangent: gaussian.bitangent ? [...gaussian.bitangent] : gaussian.bitangent,
      sigma: [...(gaussian.sigma || [0.12, 0.12, 0.03])],
      color: [...(gaussian.color || [128, 128, 128])],
    }));
    state.geometryFitResults = metricGeometry.fitResults || [];

    state.objectVoxels = new Map((raw.objectVoxels || []).map(entry => {
      const key = entry?.[0];
      const voxel = entry?.[1] || {};
      return [key, {
        ...voxel,
        key: voxel.key || key,
        point: [...(voxel.point || [0, 0, 0])],
        color: [...(voxel.color || [180, 190, 200])],
        viewIds: new Set(voxel.viewIds || []),
        roomIds: new Set(voxel.roomIds || []),
      }];
    }).filter(([key]) => typeof key === 'string'));
    state.objects = (raw.objects || []).map(object => {
      const migrated = {
        ...object,
        rgbSummary: object.rgbSummary || {
          mean: object.points?.length ? C.visualFeaturesFromColors(object.points).meanRgb : [170, 180, 188],
          pointCount: object.points?.length || 0,
        },
        shape: object.shape || {
          representation: object.kind === 'scan' ? 'legacy-colored-points' : 'manual-cuboid',
          voxelSize: object.kind === 'scan' ? CONFIG.objectVoxelSize : null,
          occupiedVolume: object.kind === 'scan' ? (object.points?.length || 0) * CONFIG.objectVoxelSize ** 3 : object.obb.extent[0] * object.obb.extent[1] * object.obb.extent[2],
          obbVolume: object.obb.extent[0] * object.obb.extent[1] * object.obb.extent[2],
          fillRatio: object.kind === 'scan' ? C.clamp(((object.points?.length || 0) * CONFIG.objectVoxelSize ** 3) / Math.max(1e-9, object.obb.extent[0] * object.obb.extent[1] * object.obb.extent[2])) : 1,
        },
      };
      if (migrated.mesh?.vertices?.length && migrated.obb) C.assignMeshAcousticFaces(migrated.mesh, migrated.obb);
      return migrated;
    });
    state.wallTextures = raw.wallTextures || {};
    state.textureImages = {};
    state.surfaceVisualEvidence = { ...(raw.surfaceVisualEvidence || {}) };
    for (const texture of Object.values(state.wallTextures)) {
      if (texture?.visualFeatures) {
        const surfaceId = `${texture.roomId}:wall:${texture.wallIndex}`;
        state.surfaceVisualEvidence[surfaceId] = texture.visualFeatures;
      }
    }
    state.acousticSurfaces = Array.isArray(raw.acousticSurfaces) ? raw.acousticSurfaces.map(surface => ({
      ...surface,
      vertices: (surface.vertices || []).map(point => [...point]),
      normal: [...(surface.normal || [0, 1, 0])],
      centroid: [...(surface.centroid || [0, 0, 0])],
      zoneIds: surface.zoneIds ? [...surface.zoneIds] : surface.zoneIds,
      material: {
        ...surface.material,
        alpha: [...(surface.material?.alpha || C.MATERIAL_LIBRARY.unknown.alpha)],
        bandConfidence: surface.material?.bandConfidence ? [...surface.material.bandConfidence] : undefined,
      },
    })) : [];
    state.acoustic = { ...state.acoustic, ...(raw.acousticSettings || {}) };
    state.acousticZones = raw.acousticZones || { primary: [], gaussians: [], all: [] };
    state.acousticInference = raw.acousticInference || null;
    state.rirAnalyses = raw.rirAnalyses || [];

    const audioCapture = raw.audioCapture || {};
    state.audio = {
      ...state.audio,
      enabled: audioCapture.enabled ?? Boolean(audioCapture.manifests?.length),
      prepared: false,
      preparing: false,
      sourceMode: audioCapture.sourceMode || 'monostatic',
      fixedSourcePosition: audioCapture.fixedSourcePosition ? [...audioCapture.fixedSourcePosition] : null,
      status: audioCapture.manifests?.length ? 'stored' : 'idle',
      meter: { rms: 0, peak: 0 },
      manifests: (audioCapture.manifests || []).map(manifest => ({ ...manifest })),
      roomSweepCounts: { ...(audioCapture.roomSweepCounts || {}) },
      lastSweepPosition: audioCapture.lastSweepPosition ? [...audioCapture.lastSweepPosition] : null,
      lastSweepYaw: audioCapture.lastSweepYaw ?? null,
      settings: { ...(audioCapture.settings || {}) },
      capabilities: { ...(audioCapture.capabilities || {}) },
      contextCreation: { ...(audioCapture.contextCreation || {}) },
      flashUntil: 0,
    };

    state.roomSequence = Math.max(0, ...state.rooms.map(room => Number(String(room.id).replace(/\D/g, '')) || 0));
    state.portalSequence = Math.max(0, ...state.portals.map(portal => Number(String(portal.id).replace(/\D/g, '')) || 0));
    state.frameSequence = Math.max(0, ...state.frames.map(frame => frame.id || 0));
    state.objectSequence = Math.max(0, ...state.objects.map(object => Number(String(object.id).replace(/\D/g, '')) || 0));
    state.activeRoomId = raw.activeRoomId && state.rooms.some(room => room.id === raw.activeRoomId)
      ? raw.activeRoomId
      : state.rooms.at(-1)?.id || null;
    state.phase = raw.phase === 'processed' ? 'processed' : 'finished';
    refreshAcousticSurfaces();
    // If the snapshot carries inference but no fully populated surface records,
    // reapply it after rebuilding geometry. Manual edits remain protected by
    // applyInferenceToAcousticSurfaces.
    if (state.acousticInference) A.applyInferenceToAcousticSurfaces(state.acousticSurfaces, state.acousticInference);
    if (migratedLegacy) log('RAW_LEGACY_MIGRATED_TO_V20_1', 'INFO', { rooms: state.rooms.length, objects: state.objects.length });
    state.interrupted = Boolean(options.restored && !options.handoff);
    state.postXrReady = true;
    state.handoffPending = false;
    state.handoffReloadScheduled = false;
    state.captureSuspended = false;
    state.navigationExitPending = false;
    updateAudioUI();
    renderObjectControls();
    renderPortalControls();
    renderAcousticControls();
    renderReview();
    updateLandingSummary();
    updateProcessingAvailability();
    return true;
  }

  async function importRawFile(file) {
    if (file.size > CONFIG.importMaxBytes) throw new Error('File RAW troppo grande');
    const raw = JSON.parse(await file.text());
    applyRawSnapshot(raw, { restored: false });
    scheduleCheckpoint('raw-import', 30);
    openScene();
  }


  function acousticExportPayload() {
    // Rebuilding the polygons is safe because the core preserves manual and
    // RIR-inferred materials. This keeps geometry references current after an
    // object edit without discarding the acoustic result.
    refreshAcousticSurfaces();
    return {
      schema: 'room-scanner-v20-1-visual-acoustic-twin',
      version: VERSION,
      revision: REVISION,
      createdAt: nowIso(),
      units: {
        length: 'm',
        time: 's',
        frequency: 'Hz',
        area: 'm2',
        absorption: 'dimensionless energy coefficient',
        scattering: 'dimensionless',
      },
      bandsHz: [...C.ACOUSTIC_BANDS],
      coefficientMeaning: {
        inferred: 'effective in-situ absorption inferred from relative-delay RIR reflections, late decay and geometry/visual regularization',
        manual: 'authoritative user edit',
        auto: 'visual/material prior only; not an acoustic measurement',
      },
      latencyPolicy: {
        absolutePropagationDelayKnown: false,
        method: 'continuous PCM clock map plus matched-filter onset and per-RIR direct-path alignment',
        consequence: 'surface association uses echo delay relative to the detected direct path, not raw hardware latency',
      },
      metricFrame: 'single WebXR local-floor reference space of the continuous capture session',
      geometry: {
        surfels: state.surfelMap.statistics(),
        gaussians: state.geometryGaussians.length,
        poseSamples: state.metricPath.length,
        roomFit: state.rooms.filter(room => room.model).map(room => ({
          roomId: room.id,
          acquisitionFootprint: room.acquisitionFootprint || room.footprint,
          fittedFootprint: room.footprint,
          geometryFit: room.geometryFit || null,
        })),
      },
      audioCapture: {
        ...serializeAudioCaptureState(),
        rawPcmEmbedded: false,
      },
      summary: C.acousticSummary(state.rooms.filter(room => room.model), state.acousticSurfaces),
      surfaces: state.acousticSurfaces.map(surface => ({
        id: surface.id,
        label: surface.label,
        ownerType: surface.ownerType,
        ownerId: surface.ownerId,
        roomId: surface.roomId,
        role: surface.role,
        face: surface.face ?? null,
        wallIndex: surface.wallIndex ?? null,
        area: surface.area,
        grossArea: surface.grossArea ?? surface.area,
        centroid: surface.centroid,
        normal: surface.normal,
        vertices: surface.vertices,
        openings: surface.openings || [],
        proxy: surface.proxy || null,
        geometryRef: surface.geometryRef || null,
        meshTriangleCount: surface.meshTriangleCount ?? null,
        zoneIds: surface.zoneIds || [],
        inferenceModel: surface.inferenceModel || null,
        material: surface.material,
      })),
      zones: state.acousticInference?.zones || [],
      lateField: state.acousticInference?.lateField || [],
      rirAnalyses: state.rirAnalyses,
      limitations: state.acousticInference?.limitations || [
        'No calibrated loudspeaker/microphone directivity is assumed.',
        'Visual-only coefficients remain priors until supported by RIR evidence.',
      ],
    };
  }

  function exportAcousticJson() {
    const payload = acousticExportPayload();
    download(`room_scan_v20_1_acoustic_${Date.now()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function exportAcousticCsv() {
    const payload = acousticExportPayload();
    const alphaHeaders = C.ACOUSTIC_BANDS.map(band => `alpha_${band}Hz`);
    const confidenceHeaders = C.ACOUSTIC_BANDS.map(band => `confidence_${band}Hz`);
    const headers = [
      'record_type', 'id', 'parent_surface_id', 'label', 'owner_type', 'owner_id',
      'room_id', 'role_or_kind', 'area_m2', 'material', 'mode', 'source',
      'mean_confidence', 'scattering', ...alphaHeaders, ...confidenceHeaders,
    ];
    const surfaceRows = payload.surfaces.map(surface => [
      'surface', surface.id, '', surface.label, surface.ownerType, surface.ownerId,
      surface.roomId || '', surface.role, surface.area, surface.material.key,
      surface.material.mode, surface.material.source, surface.material.confidence,
      surface.material.scattering, ...surface.material.alpha,
      ...(surface.material.bandConfidence || C.ACOUSTIC_BANDS.map(() => '')),
    ]);
    const zoneRows = payload.zones.map(zone => [
      'zone', zone.zoneId, zone.ownerSurfaceId, zone.zoneId, 'surface-zone',
      zone.ownerSurfaceId, zone.roomId || '', zone.kind, zone.area, '', 'inferred',
      zone.bands?.[0]?.source || zone.model, S.median(zone.confidence || [0]),
      zone.scattering, ...zone.alpha, ...(zone.confidence || C.ACOUSTIC_BANDS.map(() => '')),
    ]);
    const output = [headers, ...surfaceRows, ...zoneRows]
      .map(row => row.map(csvEscape).join(','))
      .join('\n');
    download(`room_scan_v20_1_acoustic_${Date.now()}.csv`, output, 'text/csv');
  }

  function exportPly() {
    const points = [];
    for (const object of activeObjects()) {
      for (const item of object.points || []) {
        points.push({ point: item.point, color: item.color || [190, 190, 190], objectId: Number(String(object.id).replace(/\D/g, '')) || 0, synthetic: item.synthetic ? 1 : 0 });
      }
    }
    let output = [
      'ply',
      'format ascii 1.0',
      `comment Room Scanner ${VERSION}`,
      `element vertex ${points.length}`,
      'property float x',
      'property float y',
      'property float z',
      'property uchar red',
      'property uchar green',
      'property uchar blue',
      'property ushort object_id',
      'property uchar synthetic',
      'end_header',
    ].join('\n') + '\n';
    for (const item of points) {
      output += `${item.point[0]} ${item.point[1]} ${item.point[2]} ${item.color[0] | 0} ${item.color[1] | 0} ${item.color[2] | 0} ${item.objectId} ${item.synthetic}\n`;
    }
    download(`room_scan_v20_1_${Date.now()}.ply`, output, 'application/octet-stream');
  }

  function exportObj() {
    let output = `# Room Scanner ${VERSION}\n# Metric room shells and active objects\n`;
    let base = 1;
    for (const room of state.rooms.filter(item => item.model)) {
      const mesh = C.roomShellMesh(room, state.portals);
      output += `g ROOM_${room.id}\n`;
      for (const vertex of mesh.vertices) output += `v ${vertex[0]} ${vertex[1]} ${vertex[2]}\n`;
      for (let index = 0; index < mesh.indices.length; index += 3) {
        output += `f ${base + mesh.indices[index]} ${base + mesh.indices[index + 1]} ${base + mesh.indices[index + 2]}\n`;
      }
      base += mesh.vertices.length;
    }
    for (const object of activeObjects()) {
      const mesh = object.mesh || C.boxMesh(object.obb.center, object.obb.extent, object.obb.yaw);
      output += `g OBJECT_${object.id}\n`;
      // Many OBJ readers accept the de-facto vertex-color extension
      // `v x y z r g b`.  Emit it for scanned objects while retaining valid
      // geometry in readers that ignore the trailing components.
      const fallbackColor = object.rgbSummary?.mean || [190, 190, 190];
      for (let vertexIndex = 0; vertexIndex < mesh.vertices.length; vertexIndex += 1) {
        const vertex = mesh.vertices[vertexIndex];
        const color = mesh.colors?.[vertexIndex] || fallbackColor;
        output += `v ${vertex[0]} ${vertex[1]} ${vertex[2]} ${(color[0] / 255).toFixed(6)} ${(color[1] / 255).toFixed(6)} ${(color[2] / 255).toFixed(6)}\n`;
      }
      for (let index = 0; index < mesh.indices.length; index += 3) {
        output += `f ${base + mesh.indices[index]} ${base + mesh.indices[index + 1]} ${base + mesh.indices[index + 2]}\n`;
      }
      base += mesh.vertices.length;
    }
    download(`room_scan_v20_1_${Date.now()}.obj`, output, 'text/plain');
  }

  /* -----------------------------------------------------------------------
   * Event wiring and public test hooks
   * -------------------------------------------------------------------- */

  async function resetScan() {
    if (state.session) {
      alert('Usa “Salva e chiudi” prima di iniziare una nuova scansione.');
      return;
    }
    if (state.rooms.length || state.frames.length || state.objects.length || state.checkpointAvailable) {
      const accepted = confirm('Cancellare la scansione corrente e il salvataggio automatico? Esporta prima il RAW se vuoi conservarli.');
      if (!accepted) return;
    }
    await deleteCheckpoint();
    try {
      const controller = state.audioController || ensureAudioController();
      controller.freezeScheduling?.();
      if (controller.context) await controller.stop({ flush: false, persist: false });
      await controller.clearPersisted();
    } catch (error) {
      log('AUDIO_RESET_WARNING', 'WARN', { error: errorText(error) });
    }
    clearHandoffMarker();
    try { globalThis.RoomScanDiagnostics?.markExpectedClose?.('new-scan-reset'); } catch {}
    // A reload is intentional: it also releases decoded images, WebGL objects,
    // workers and large typed arrays that mobile browsers may otherwise retain.
    location.reload();
  }

  async function compatibilityCheck() {
    if (!window.isSecureContext) {
      setBoot(0, 'HTTPS richiesto per WebXR.', 'bad');
      return;
    }
    if (!navigator.xr?.isSessionSupported) {
      setBoot(0, 'WebXR non rilevato. Usa Chrome Android su dispositivo ARCore.', 'bad');
      return;
    }
    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      setBoot(supported ? 1 : 0, supported ? 'WebXR immersive-ar disponibile.' : 'Immersive AR non supportato su questo dispositivo.', supported ? 'good' : 'bad');
    } catch (error) {
      setBoot(0, `Verifica WebXR fallita: ${errorText(error)}`, 'bad');
    }
  }

  function initialize() {
    if (state.initialized) return;
    state.initialized = true;
    $('prepareAudio').addEventListener('click', () => prepareAudio().catch(error => alert(errorText(error))));
    $('audioEnabled').addEventListener('change', async () => {
      state.audio.enabled = $('audioEnabled').checked;
      if (!state.audio.enabled && state.audioController) {
        try { await state.audioController.stop({ flush: false, persist: false }); } catch {}
        state.audioController = null;
        state.audio.prepared = false;
        state.audio.status = 'disabled';
      }
      updateAudioUI();
    });
    $('sourceMode').addEventListener('change', updateAudioUI);
    $('startXR').addEventListener('click', startXR);
    $('newScan').addEventListener('click', () => resetScan().catch(error => alert(errorText(error))));
    $('resumeCheckpoint').addEventListener('click', () => restoreCheckpoint().catch(error => alert(errorText(error))));
    $('fullscreen').addEventListener('click', requestFullscreen);
    $('stopXR').addEventListener('click', interruptXR);
    $('primaryButton').addEventListener('click', primaryAction);
    $('secondaryButton').addEventListener('click', secondaryAction);
    $('finishButton').addEventListener('click', finishAction);
    $('processModel').addEventListener('click', processModel);
    $('reviewProcess').addEventListener('click', processModel);
    $('processCancel').addEventListener('click', () => { state.process.cancel = true; });
    $('openPlan').addEventListener('click', openPlan);
    $('openScene').addEventListener('click', openScene);
    $('openReview').addEventListener('click', openReview);
    $('exportRaw').addEventListener('click', exportRaw);
    $('exportPly').addEventListener('click', exportPly);
    $('exportObj').addEventListener('click', exportObj);
    $('exportAcousticJson').addEventListener('click', exportAcousticJson);
    $('exportAcousticCsv').addEventListener('click', exportAcousticCsv);
    const exportDiagnostics = trigger => {
      const diagnostics = globalThis.RoomScanDiagnostics;
      if (!diagnostics?.exportBundle) { alert('Modulo diagnostico non disponibile.'); return; }
      diagnostics.exportBundle({ trigger }).catch(error => alert(`Export diagnostico fallito: ${errorText(error)}`));
    };
    $('exportDiagnostics').addEventListener('click', () => exportDiagnostics('manual-landing'));
    $('exportDiagnosticsXR').addEventListener('click', () => exportDiagnostics('manual-xr'));
    $('importRaw').addEventListener('click', () => $('fileRaw').click());
    $('fileRaw').addEventListener('change', event => {
      const file = event.target.files?.[0];
      if (file) importRawFile(file).catch(error => alert(errorText(error)));
    });
    $('planCanvas').addEventListener('pointerdown', handlePlanPointer);
    $('addObject').addEventListener('click', toggleAddObject);
    $('objectSelect').addEventListener('change', updateObjectForm);
    $('applyObject').addEventListener('click', applyObjectEdits);
    $('objectHide').addEventListener('click', () => {
      const object = selectedObject();
      if (!object) return;
      object.hidden = !object.hidden;
      refreshAcousticSurfaces();
      updateObjectForm();
      renderPlan();
      renderScene();
      scheduleCheckpoint('object-visibility');
    });
    $('objectRemove').addEventListener('click', () => {
      const object = selectedObject();
      if (!object) return;
      object.status = 'removed';
      refreshAcousticSurfaces();
      renderObjectControls();
      renderPlan();
      renderScene();
      scheduleCheckpoint('object-removed');
    });
    $('objectRestore').addEventListener('click', () => {
      const object = selectedObject();
      if (!object) return;
      object.status = 'active';
      object.hidden = false;
      refreshAcousticSurfaces();
      renderObjectControls();
      renderPlan();
      renderScene();
      scheduleCheckpoint('object-restored');
    });
    $('portalSelect').addEventListener('change', updatePortalForm);
    $('applyPortal').addEventListener('click', applyPortalEdits);
    $('acousticSurfaceSelect').addEventListener('change', () => { state.acoustic.selectedId = $('acousticSurfaceSelect').value || null; updateAcousticForm(); renderScene(); });
    $('acousticMaterial').addEventListener('change', previewAcousticMaterial);
    $('applyAcoustic').addEventListener('click', applyAcousticEdits);
    $('resetAcoustic').addEventListener('click', resetAcousticAuto);
    for (const id of ['layerRoom', 'layerTexture', 'layerObjects', 'layerObjectShape', 'layerBoxes', 'layerGaussians', 'layerAcoustic', 'bareRoom']) $(id).addEventListener('change', renderScene);
    $('acousticBand').addEventListener('change', () => { state.acoustic.bandIndex = Number($('acousticBand').value) || 0; renderAcousticControls(); renderScene(); });
    $('sceneIso').addEventListener('click', () => {
      state.viewer.yaw = Math.PI / 4;
      state.viewer.pitch = -0.62;
      state.viewer.zoom = 1;
      state.viewer.pan = [0, 0];
      state.viewer.focus = null;
      renderScene();
    });
    const sceneCanvas = $('sceneCanvas');
    sceneCanvas.addEventListener('pointerdown', event => {
      state.viewer.drag = { x: event.clientX, y: event.clientY, yaw: state.viewer.yaw, pitch: state.viewer.pitch };
      sceneCanvas.setPointerCapture?.(event.pointerId);
    });
    sceneCanvas.addEventListener('pointermove', event => {
      if (!state.viewer.drag) return;
      state.viewer.yaw = state.viewer.drag.yaw + (event.clientX - state.viewer.drag.x) * 0.008;
      state.viewer.pitch = C.clamp(state.viewer.drag.pitch + (event.clientY - state.viewer.drag.y) * 0.006, -1.35, 0.15);
      renderScene();
    });
    sceneCanvas.addEventListener('pointerup', () => { state.viewer.drag = null; });
    sceneCanvas.addEventListener('pointercancel', () => { state.viewer.drag = null; });
    sceneCanvas.addEventListener('wheel', event => {
      event.preventDefault?.();
      state.viewer.zoom = C.clamp(state.viewer.zoom * Math.exp(-event.deltaY * 0.001), 0.35, 6);
      renderScene();
    }, { passive: false });
    document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => {
      button.closest('.modal').classList.add('hidden');
    }));
    window.addEventListener('resize', () => {
      renderPlan();
      renderScene();
    });
    window.addEventListener('error', event => reportRuntimeError(event.error || event.message, 'WINDOW'));
    window.addEventListener('unhandledrejection', event => reportRuntimeError(event.reason || 'Promise rejection', 'PROMISE'));
    window.addEventListener('popstate', () => { handleBrowserBack().catch(error => reportRuntimeError(error, 'BACK')); });
    window.addEventListener('pagehide', () => {
      if (!state.session && !state.navigationExitPending && !state.handoffPending) scheduleCheckpoint('pagehide', 0);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && !state.session && !state.navigationExitPending && !state.handoffPending) {
        scheduleCheckpoint('visibility-hidden', 0);
      }
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(`./sw_v20_1_0.js?build=${REVISION}`).catch(error => log('SW_FAILED', 'WARN', { error: errorText(error) }));
    updateHUD();
    renderObjectControls();
    renderPortalControls();
    renderReview();
    updateLandingSummary();
    updateProcessingAvailability();
    recoverPostXRHandoff().catch(error => log('HANDOFF_RECOVERY_FAILED', 'WARN', { error: errorText(error) }));
    compatibilityCheck();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();

  globalThis.__ROOM_SCANNER_V20__ = {
    VERSION,
    REVISION,
    CONFIG,
    state,
    beginRoom,
    addCorner,
    closeRoom,
    confirmHeight,
    ensureRoomPhotoTargets,
    evaluateTargetNow,
    coverageStats,
    roomCompletionReadiness,
    coverageGuidance,
    completeRoom,
    beginTransition,
    finishTransition,
    captureKeyframe,
    classifyXRFrameObjects,
    fitSamplesForFrame,
    classifyDeepFrame,
    selectProcessingFrames,
    buildObjects,
    buildRawSnapshot,
    applyRawSnapshot,
    persistCheckpoint,
    restoreCheckpoint,
    readCheckpoint,
    cancelScheduledCheckpoint,
    armHistoryGuard,
    handleBrowserBack,
    saveAndCloseXR,
    onXREnd,
    exportRaw,
    exportAcousticJson,
    exportAcousticCsv,
    acousticExportPayload,
    refreshAcousticSurfaces,
    applyAcousticEdits,
    previewAcousticMaterial,
    acousticEditTargets,
    applyObjectEdits,
    primaryAction,
    secondaryAction,
    armOrFinishAcquisition,
    updateHUD,
    renderOverlay,
    completePostXRHandoff,
    recoverPostXRHandoff,
    cleanupXRResources,
    updateProcessingAvailability,
    prepareAudio,
    acousticSweepTick,
    recordMetricPose,
    fuseLiveDepthFrame,
    fitMetricSceneFromSurfels,
    processAcousticMeasurements,
    processModel,
  };
  try { globalThis.RoomScanDiagnostics?.appReady?.(); } catch {}
  // Keep the previous test/integration hook as a compatibility alias while
  // making V20 explicit to new consumers.
  globalThis.__ROOM_SCANNER_V15__ = globalThis.__ROOM_SCANNER_V20__;
})();
