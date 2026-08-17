/*
 * Room Scanner V15.1.0 - Wall Targets application
 * ------------------------------------------------
 * Smartphone-first browser scanner for connected indoor spaces.
 *
 * User contract:
 *   1. Start WebXR once.
 *   2. Aim at the floor/wall corners and tap each corner.
 *   3. Aim once at a wall/ceiling junction.
 *   4. Walk slowly and look around; keyframes are captured automatically.
 *   5. Walk through a doorway and repeat for the next room.
 *   6. End WebXR, then run optional Deep batch processing.
 *
 * Metric contract:
 *   - local-floor WebXR coordinates are the only global metric reference;
 *   - every photo stores synchronized pose, projection and sparse XR depth;
 *   - Depth Anything output is fitted to those WebXR/shell anchors per photo;
 *   - neural depth may create object evidence but cannot move a wall.
 */
(function roomScannerApplication() {
  'use strict';

  const C = globalThis.RoomScanCore;
  if (!C) throw new Error('roomscan_core.js non caricato');

  const VERSION = '15.1.0';
  const REVISION = 'v15.1.0-wall-targets-recovery-20260817';
  const RAW_SCHEMA = 'room-scanner-v15-raw';
  const CHECKPOINT_DB = 'room-scanner-v15-checkpoints';
  const CHECKPOINT_STORE = 'snapshots';
  const CHECKPOINT_KEY = 'latest';

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
    importMaxBytes: 80 * 1024 * 1024,
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
    openReviewAfterEnd: false,
    historyGuardActive: false,
    historyUnwinding: false,
    checkpointDbPromise: null,
    checkpointTimer: null,
    checkpointSaving: false,
    checkpointQueuedReason: null,
    checkpointAvailable: false,
    checkpointLastSavedAt: null,
    initialized: false,
  };

  const $ = id => document.getElementById(id);
  const errorText = error => error?.message || String(error);
  const nowIso = () => new Date().toISOString();
  const nowMs = () => Date.now();
  const degrees = radians => radians * 180 / Math.PI;

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

  async function persistCheckpoint(reason = 'auto') {
    if (state.checkpointSaving) {
      state.checkpointQueuedReason = reason;
      return false;
    }
    const database = await openCheckpointDatabase();
    if (!database) return false;
    state.checkpointSaving = true;
    try {
      const savedAt = nowIso();
      const raw = buildRawSnapshot({ checkpoint: true });
      await checkpointTransaction(database, 'readwrite', store => {
        store.put({ key: CHECKPOINT_KEY, savedAt, reason, raw });
      });
      state.checkpointAvailable = true;
      state.checkpointLastSavedAt = savedAt;
      updateCheckpointUI();
      log('CHECKPOINT_SAVED', 'INFO', { reason, rooms: raw.rooms.length, frames: raw.frames.length });
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
    if (!globalThis.indexedDB) return;
    if (state.checkpointTimer) clearTimeout(state.checkpointTimer);
    state.checkpointTimer = setTimeout(() => {
      state.checkpointTimer = null;
      persistCheckpoint(reason).catch(() => {});
    }, Math.max(0, delay));
    state.checkpointTimer?.unref?.();
  }

  async function readCheckpoint() {
    const database = await openCheckpointDatabase();
    if (!database) return null;
    return checkpointTransaction(database, 'readonly', (store, setResult) => {
      const request = store.get(CHECKPOINT_KEY);
      request.onsuccess = () => setResult(request.result || null);
      request.onerror = () => setResult(null);
    }).catch(error => {
      log('CHECKPOINT_READ_FAILED', 'WARN', { error: errorText(error) });
      return null;
    });
  }

  async function detectCheckpoint() {
    const checkpoint = await readCheckpoint();
    state.checkpointAvailable = Boolean(checkpoint?.raw);
    state.checkpointLastSavedAt = checkpoint?.savedAt || null;
    updateCheckpointUI();
    return checkpoint;
  }

  async function deleteCheckpoint() {
    if (state.checkpointTimer) {
      clearTimeout(state.checkpointTimer);
      state.checkpointTimer = null;
    }
    const database = await openCheckpointDatabase();
    if (database) {
      await checkpointTransaction(database, 'readwrite', store => { store.delete(CHECKPOINT_KEY); }).catch(() => {});
    }
    state.checkpointAvailable = false;
    state.checkpointLastSavedAt = null;
    updateCheckpointUI();
  }

  async function restoreCheckpoint() {
    const checkpoint = await readCheckpoint();
    if (!checkpoint?.raw) {
      state.checkpointAvailable = false;
      updateCheckpointUI();
      alert('Nessun salvataggio automatico disponibile.');
      return false;
    }
    applyRawSnapshot(checkpoint.raw, { restored: true });
    state.checkpointAvailable = true;
    state.checkpointLastSavedAt = checkpoint.savedAt || null;
    updateCheckpointUI();
    setBoot(1, 'Scansione ripristinata in modalita revisione.', 'good');
    openReview();
    return true;
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
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    return canvas.toDataURL('image/jpeg', quality);
  }

  async function jpegToRGBA(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height);
        resolve({ rgba: data.data, width: canvas.width, height: canvas.height });
      };
      image.onerror = () => reject(new Error('Immagine keyframe non decodificabile'));
      image.src = dataUrl;
    });
  }

  async function ensureFrameRGBA(frame) {
    if (frame.rgba) return frame;
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
      optionalFeatures: ['hit-test', 'anchors', 'plane-detection', 'depth-sensing', 'light-estimation'],
      domOverlay: { root: document.body },
      depthSensing: {
        usagePreference: ['cpu-optimized'],
        dataFormatPreference: ['float32', 'unsigned-short', 'luminance-alpha'],
      },
    });
  }

  async function startXR() {
    if (state.session || state.xrStarting) return;
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
        }).catch(() => {});
      }
      session.addEventListener('end', onXREnd, { once: true });
      state.phase = 'starting';
      state.trackingLost = false;
      state.normalEnding = false;
      state.captureSuspended = false;
      state.navigationExitPending = false;
      state.openReviewAfterEnd = false;
      state.frameCount = 0;
      $('welcome').classList.add('hidden');
      $('arCanvas').classList.remove('hidden');
      $('overlayCanvas').classList.remove('hidden');
      $('hud').classList.remove('hidden');
      document.body.classList.add('xr-active');
      armHistoryGuard();
      session.requestAnimationFrame(onXRFrame);
      log('XR_STARTED', 'INFO', { revision: REVISION });
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
      $('startXR').disabled = false;
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
  }

  function onXREnd() {
    const wasNormal = state.normalEnding;
    const shouldOpenReview = state.openReviewAfterEnd || (!wasNormal && state.rooms.length > 0);
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
      setBoot(1, 'WebXR chiuso: i dati acquisiti sono stati conservati per la revisione.', 'warn');
      log('XR_ENDED_UNEXPECTED_BUT_RECOVERED', 'WARN');
    } else {
      setBoot(1, 'Acquisizione salvata. Ora puoi rivedere o processare Deep.', 'good');
      log('XR_ENDED_NORMAL');
    }
    state.normalEnding = false;
    state.captureSuspended = false;
    state.navigationExitPending = false;
    state.openReviewAfterEnd = false;
    releaseHistoryGuard();
    scheduleCheckpoint('xr-end', 20);
    renderReview();
    updateLandingSummary();
    if (shouldOpenReview && state.rooms.length) openReview();
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
      updateHitTest(frame);
      updatePlaneSummary(frame);
      updateAimSamples(time);
      updateHeightCandidate(time);
      updateTransitionPath(time);
      processAnchorQueue(frame);
      if (state.phase === 'starting') beginRoom();
      fulfillCaptureRequest(frame, view, time);
      autoCaptureTick(time);
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
    state.openReviewAfterEnd = true;
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
    await persistCheckpoint(reason);
    if (!endingSession) {
      state.normalEnding = false;
      state.navigationExitPending = false;
      state.captureSuspended = false;
      if (state.rooms.length) openReview();
      return true;
    }
    try {
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
        alert('Non sono riuscito a chiudere WebXR. La scansione e gia salvata; riprova con “Salva e chiudi”.');
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
    if (room.footprint.length >= 3 && C.len2(C.sub2(raw, room.footprint[0])) < 0.24) {
      closeRoom();
      return;
    }
    const snapped = C.snapFloorCorner(raw, room.footprint, { orthogonal: $('smartSnap')?.checked !== false });
    const point = snapped.point;
    if (room.footprint.length && C.len2(C.sub2(point, room.footprint[room.footprint.length - 1])) < 0.20) {
      alert('Questo angolo e troppo vicino al precedente. Spostati o mira al prossimo angolo.');
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
    const validation = C.validateFootprint(room.footprint);
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
    const id = `v15-${++state.workerSequence}`;
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
    const worker = new Worker(`./depth_ai_worker_v15_1_0.js?build=${REVISION}`);
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
    return { rgba: context.getImageData(0, 0, outputWidth, outputHeight).data, width: outputWidth, height: outputHeight };
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
      await ensureFrameRGBA(frame);
      classifyXRFrameObjects(frame, room);
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

  async function buildWallTextures(profile) {
    state.wallTextures = {};
    state.textureImages = {};
    for (const room of state.rooms) {
      if (!room.model) continue;
      for (const wall of room.model.walls) {
        if (state.process.cancel) throw new Error('PROCESS_CANCELLED');
        const frames = roomFrames(room.id)
          .filter(frame => (frame.wallVisibility?.[wall.index] || 0) > 0.20)
          .sort((a, b) => b.quality - a.quality)
          .slice(0, profile.id === 'accurate' ? 4 : 3);
        if (!frames.length) continue;
        for (const frame of frames) await ensureFrameRGBA(frame);
        const width = Math.max(48, Math.min(profile.textureMaxWidth, Math.round(wall.length * profile.texturePpm)));
        const height = Math.max(48, Math.min(profile.textureMaxHeight, Math.round(room.model.height * profile.texturePpm)));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        const imageData = context.createImageData(width, height);
        const pixels = imageData.data;
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
            const index = 4 * (py * width + px);
            pixels[index] = bestColor[0];
            pixels[index + 1] = bestColor[1];
            pixels[index + 2] = bestColor[2];
            pixels[index + 3] = 255;
          }
          if (py && py % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        }
        context.putImageData(imageData, 0, 0);
        state.wallTextures[`${room.id}:${wall.index}`] = {
          roomId: room.id,
          wallIndex: wall.index,
          width,
          height,
          dataUrl: canvas.toDataURL('image/jpeg', 0.84),
          frameIds: frames.map(frame => frame.id),
        };
      }
      for (const frame of roomFrames(room.id)) frame.rgba = null;
    }
  }

  async function processModel() {
    if (state.process.running) return;
    if (state.session) {
      alert('Termina prima la scansione WebXR. Deep viene eseguito solo dopo la chiusura del reference space.');
      return;
    }
    if (!state.rooms.some(room => room.model) || !state.frames.length) {
      alert('Completa almeno un vano con alcune fotografie.');
      return;
    }
    const profile = qualityProfile();
    const frames = selectProcessingFrames(profile);
    state.process = { running: true, cancel: false, total: frames.length, done: 0, fused: 0, stage: '' };
    showProcess(true);
    let deepAvailable = true;
    try {
      updateProcessUI('Ricostruzione XR sparsa', 0.02, 'Ricalcolo deterministico dei residui oggetto dai depth grid WebXR.');
      await rebuildXRObjectVoxels();
      try {
        await ensureDepthWorker(profile.input);
      } catch (error) {
        deepAvailable = false;
        log('DEEP_UNAVAILABLE_XR_ONLY', 'WARN', { error: errorText(error) });
        updateProcessUI('Deep non disponibile', 0.68, 'Continuo con depth XR, oggetti manuali e texture fotografiche.');
      }
      if (deepAvailable) {
        for (let index = 0; index < frames.length; index += 1) {
          if (state.process.cancel) throw new Error('PROCESS_CANCELLED');
          const frame = frames[index];
          const room = state.rooms.find(item => item.id === frame.roomId);
          updateProcessUI(`Deep ${index + 1}/${frames.length}`, 0.08 + 0.60 * index / Math.max(1, frames.length), `${room?.name || frame.roomId}: scala per-foto da WebXR e shell metrica.`);
          try {
            await inferDepth(frame, profile);
            classifyDeepFrame(frame, room);
            frame.status = 'processed';
            state.process.fused += 1;
          } catch (error) {
            frame.status = 'weak';
            frame.reason = errorText(error);
            log('DEEP_FRAME_WEAK', 'WARN', { frameId: frame.id, error: frame.reason });
          } finally {
            frame.deep = null;
          }
          state.process.done = index + 1;
          updateProcessUI(`Deep ${index + 1}/${frames.length}`, 0.08 + 0.60 * (index + 1) / Math.max(1, frames.length));
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
      updateProcessUI('Oggetti', 0.74, 'Componenti voxel persistenti da viste spazialmente distinte.');
      buildObjects();
      updateProcessUI('Texture pareti', 0.82, 'Proiezione bounded dei migliori keyframe sulle superfici metriche.');
      await buildWallTextures(profile);
      state.phase = 'processed';
      updateProcessUI('Completato', 1, `${state.rooms.length} vani, ${state.portals.length} passaggi, ${state.objects.length} oggetti.${deepAvailable ? '' : ' Modalita XR-only.'}`);
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
      }
      showProcess(false);
    } finally {
      destroyDepthWorker('Batch completato o interrotto');
      state.process.running = false;
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
    $('screenTint').classList.add('hidden');

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
      case 'starting': return 'Mantieni il telefono fermo finche compare il reticolo.';
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
    const camera = state.currentCamera;
    const stats = room?.model ? coverageStats(room) : null;
    $('metricText').textContent = camera
      ? `x ${camera.position[0].toFixed(2)} | y ${camera.position[1].toFixed(2)} | z ${camera.position[2].toFixed(2)} m | v ${state.motion.linear.toFixed(2)} m/s${room?.model ? ` | area ${room.model.area.toFixed(2)} m2 | H ${room.model.height.toFixed(2)} m` : ''}`
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

    if (state.phase === 'corners') {
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
    if (state.phase === 'corners') addCorner();
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
    if (state.phase === 'corners') undoCorner();
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
    const objectType = object.kind === 'manual' ? 'Cuboide manuale' : (object.edited ? 'Cuboide corretto' : 'Voxel multi-vista');
    $('objectInfo').textContent = `${objectType} | conf ${Math.round(object.confidence * 100)}% | ${object.points?.length || 0} punti`;
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
    const oldBottom = object.obb.center[1] - object.obb.extent[1] / 2;
    object.obb.extent = extent;
    object.obb.yaw = yaw;
    object.obb.center[1] = oldBottom + extent[1] / 2;
    // Once a user corrects an automatic object, its editable cuboid becomes
    // authoritative for both preview and OBJ export. The original point list
    // is retained for diagnostics and PLY export.
    object.mesh = C.boxMesh(object.obb.center, extent, yaw);
    object.edited = true;
    log('OBJECT_EDITED', 'INFO', { objectId: object.id, extent, yaw });
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
    renderPlan();
    renderScene();
    scheduleCheckpoint('portal-edited');
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
    return [rotatedX * scale, (cp * y - sp * rotatedZ) * scale];
  }

  function textureImage(key) {
    const texture = state.wallTextures[key];
    if (!texture) return null;
    if (state.textureImages[key]) return state.textureImages[key];
    const image = new Image();
    image.onload = renderScene;
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

    if ($('layerObjects').checked && !$('bareRoom').checked) {
      for (const object of objects) {
        if (object.points?.length && object.kind === 'scan') {
          context.fillStyle = '#f5b86d';
          const step = Math.max(1, Math.ceil(object.points.length / 1800));
          for (let index = 0; index < object.points.length; index += step) {
            const point = convert(object.points[index].point);
            context.globalAlpha = 0.55;
            context.fillRect(point.x - 1.2, point.y - 1.2, 2.4, 2.4);
          }
          context.globalAlpha = 1;
        }
        if ($('layerBoxes').checked || object.kind === 'manual') {
          const mesh = object.kind === 'manual' ? object.mesh : C.boxMesh(object.obb.center, object.obb.extent, object.obb.yaw);
          context.strokeStyle = object.kind === 'manual' ? '#ffd166' : '#f2a65a';
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
      ? state.objects.map(object => `<div class="reviewCard"><b>${escapeHtml(object.name)}</b><span>${object.kind} | ${object.obb.extent.map(value => value.toFixed(2)).join(' x ')} m | ${object.status}</span></div>`).join('')
      : '<span class="small">Nessun oggetto. Puoi aggiungere cuboidi dalla mappa.</span>';
  }

  function updateLandingSummary() {
    if (!$('landingSummary')) return;
    const rooms = state.rooms.filter(room => room.model).length;
    $('landingSummary').textContent = rooms
      ? `${rooms} vani | ${state.frames.length} foto | ${state.portals.length} passaggi | ${state.objects.length} oggetti | stato ${state.phase}`
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
    const selected = checkpoint && entries.length > 18000
      ? entries.sort((a, b) => {
        const score = voxel => (voxel.viewIds?.size || 0) * 2
          + (voxel.xrCount || 0) * 0.7
          + (voxel.deepCount || 0) * 0.5
          + Math.min(2, voxel.weight || 0);
        return score(b[1]) - score(a[1]);
      }).slice(0, 18000)
      : entries;
    return selected.map(([key, voxel]) => [key, {
      ...voxel,
      point: [...(voxel.point || [0, 0, 0])],
      color: [...(voxel.color || [180, 190, 200])],
      viewIds: [...(voxel.viewIds || [])],
      roomIds: [...(voxel.roomIds || [])],
    }]);
  }

  function buildRawSnapshot(options = {}) {
    const checkpoint = Boolean(options.checkpoint);
    return {
      schema: RAW_SCHEMA,
      version: VERSION,
      revision: REVISION,
      createdAt: nowIso(),
      checkpoint,
      phase: state.phase,
      activeRoomId: state.activeRoomId,
      rooms: state.rooms.map(room => ({
        id: room.id,
        name: room.name,
        status: room.status,
        footprint: room.footprint,
        corners: room.corners,
        height: room.height,
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
        depthGrid: serializeDepthGrid(frame.depthGrid),
        deepMask: serializeMask(frame.deepMask),
      })),
      objectVoxels: serializeObjectVoxels(checkpoint),
      // Checkpoints prioritize safe recovery on mobile. Extremely dense point
      // clouds are capped there; explicit RAW export keeps every point.
      objects: checkpoint
        ? state.objects.map(object => ({
          ...object,
          points: object.points?.length > 12000 ? object.points.slice(0, 12000) : object.points,
        }))
        : state.objects,
      wallTextures: state.wallTextures,
      logs: state.logs,
    };
  }

  function exportRaw() {
    const raw = buildRawSnapshot();
    download(`room_scan_v15_1_${Date.now()}.json`, JSON.stringify(raw), 'application/json');
  }

  function applyRawSnapshot(raw, options = {}) {
    if (raw?.schema !== RAW_SCHEMA) throw new Error(`Schema incompatibile: ${raw?.schema}`);
    const roomsNeedingTargetRebuild = new Set();
    state.rooms = (raw.rooms || []).map(room => {
      const model = room.footprint?.length >= 3
        ? C.buildRoomModel(room.footprint, 0, room.height || CONFIG.defaultHeight)
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
        model,
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
    state.objects = raw.objects || [];
    state.wallTextures = raw.wallTextures || {};
    state.textureImages = {};
    state.roomSequence = Math.max(0, ...state.rooms.map(room => Number(String(room.id).replace(/\D/g, '')) || 0));
    state.portalSequence = Math.max(0, ...state.portals.map(portal => Number(String(portal.id).replace(/\D/g, '')) || 0));
    state.frameSequence = Math.max(0, ...state.frames.map(frame => frame.id || 0));
    state.objectSequence = Math.max(0, ...state.objects.map(object => Number(String(object.id).replace(/\D/g, '')) || 0));
    state.activeRoomId = raw.activeRoomId && state.rooms.some(room => room.id === raw.activeRoomId)
      ? raw.activeRoomId
      : state.rooms.at(-1)?.id || null;
    state.phase = raw.phase === 'processed' ? 'processed' : 'finished';
    state.interrupted = Boolean(options.restored);
    state.captureSuspended = false;
    state.navigationExitPending = false;
    renderObjectControls();
    renderPortalControls();
    renderReview();
    updateLandingSummary();
    return true;
  }

  async function importRawFile(file) {
    if (file.size > CONFIG.importMaxBytes) throw new Error('File RAW troppo grande');
    const raw = JSON.parse(await file.text());
    applyRawSnapshot(raw, { restored: false });
    scheduleCheckpoint('raw-import', 30);
    openScene();
  }

  function exportPly() {
    const points = [];
    for (const object of activeObjects()) {
      for (const item of object.points || []) {
        points.push({ point: item.point, color: item.color || [190, 190, 190], objectId: Number(String(object.id).replace(/\D/g, '')) || 0 });
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
      'end_header',
    ].join('\n') + '\n';
    for (const item of points) {
      output += `${item.point[0]} ${item.point[1]} ${item.point[2]} ${item.color[0] | 0} ${item.color[1] | 0} ${item.color[2] | 0} ${item.objectId}\n`;
    }
    download(`room_scan_v15_1_${Date.now()}.ply`, output, 'application/octet-stream');
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
      for (const vertex of mesh.vertices) output += `v ${vertex[0]} ${vertex[1]} ${vertex[2]}\n`;
      for (let index = 0; index < mesh.indices.length; index += 3) {
        output += `f ${base + mesh.indices[index]} ${base + mesh.indices[index + 1]} ${base + mesh.indices[index + 2]}\n`;
      }
      base += mesh.vertices.length;
    }
    download(`room_scan_v15_1_${Date.now()}.obj`, output, 'text/plain');
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
      updateObjectForm();
      renderPlan();
      renderScene();
      scheduleCheckpoint('object-visibility');
    });
    $('objectRemove').addEventListener('click', () => {
      const object = selectedObject();
      if (!object) return;
      object.status = 'removed';
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
      renderObjectControls();
      renderPlan();
      renderScene();
      scheduleCheckpoint('object-restored');
    });
    $('portalSelect').addEventListener('change', updatePortalForm);
    $('applyPortal').addEventListener('click', applyPortalEdits);
    for (const id of ['layerRoom', 'layerTexture', 'layerObjects', 'layerBoxes', 'bareRoom']) $(id).addEventListener('change', renderScene);
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
    window.addEventListener('pagehide', () => scheduleCheckpoint('pagehide', 0));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') scheduleCheckpoint('visibility-hidden', 0);
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register(`./sw_v15_1_0.js?build=${REVISION}`).catch(error => log('SW_FAILED', 'WARN', { error: errorText(error) }));
    updateHUD();
    renderObjectControls();
    renderPortalControls();
    renderReview();
    updateLandingSummary();
    detectCheckpoint().catch(() => {});
    compatibilityCheck();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();

  globalThis.__ROOM_SCANNER_V15__ = {
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
    armHistoryGuard,
    handleBrowserBack,
    saveAndCloseXR,
    onXREnd,
    exportRaw,
    primaryAction,
    secondaryAction,
    armOrFinishAcquisition,
    updateHUD,
    renderOverlay,
  };
})();
