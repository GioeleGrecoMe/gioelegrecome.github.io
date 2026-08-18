/*
 * Room Scanner V20.1.0 - deep diagnostic bundle
 * ---------------------------------------------------------------
 * This module is intentionally independent from the metric/audio pipeline.
 * It observes the application and can be removed without changing scanning
 * behaviour. It records lifecycle/errors/network/console diagnostics and,
 * only when the user asks or explicitly confirms after a fault, exports a
 * compressed JSONL bundle containing the full in-memory RAW snapshot plus the
 * persisted checkpoint/JPEG and acoustic PCM records available in IndexedDB.
 *
 * Browser limitation handled explicitly:
 * pagehide/beforeunload cannot reliably display confirm() or start downloads.
 * Therefore a dirty-session marker is persisted synchronously. On the next
 * launch the user is asked whether to export the diagnostic bundle.
 */
(function attachRoomScanDiagnostics(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RoomScanDiagnostics = api;
  api.install();
})(typeof globalThis !== 'undefined' ? globalThis : this, function roomScanDiagnosticsFactory(root) {
  'use strict';

  const BUILD = 'v20.1.0-diagnostics-20260818';
  const SESSION_KEY = 'room-scanner-v20-diagnostic-session';
  const EVENTS_KEY = 'room-scanner-v20-diagnostic-events';
  const FAULT_KEY = 'room-scanner-v20-diagnostic-pending-fault';
  const MAX_EVENTS = 5000;
  const MAX_PERSISTED_EVENTS = 240;
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const events = [];
  let installed = false;
  let promptActive = false;
  let expectedCloseReason = null;
  let appReadySeen = false;
  let previousSession = null;
  let consolePatched = false;
  let fetchPatched = false;
  let lastFaultSignature = '';
  let lastFaultAt = 0;

  const nowIso = () => new Date().toISOString();
  const perfNow = () => root.performance?.now?.() ?? null;

  function errorText(error) {
    if (error == null) return 'Unknown error';
    if (typeof error === 'string') return error;
    return error.message || error.name || String(error);
  }

  function safeStorageGet(key) {
    try { return root.localStorage?.getItem?.(key) || null; } catch { return null; }
  }

  function safeStorageSet(key, value) {
    try { root.localStorage?.setItem?.(key, value); return true; } catch { return false; }
  }

  function safeStorageRemove(key) {
    try { root.localStorage?.removeItem?.(key); } catch {}
  }

  function compactValue(value, depth = 0, seen = new WeakSet()) {
    if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return String(value);
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack || null };
    if (ArrayBuffer.isView(value)) return { type: value.constructor?.name || 'TypedArray', length: value.length ?? value.byteLength };
    if (value instanceof ArrayBuffer) return { type: 'ArrayBuffer', byteLength: value.byteLength };
    if (depth >= 4) return `[${value?.constructor?.name || 'Object'}]`;
    if (typeof value !== 'object') return String(value);
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 40).map(item => compactValue(item, depth + 1, seen));
    if (value instanceof Map) return { type: 'Map', size: value.size };
    if (value instanceof Set) return { type: 'Set', size: value.size };
    const out = {};
    let count = 0;
    for (const [key, child] of Object.entries(value)) {
      if (count++ >= 50) { out.__truncatedKeys = true; break; }
      try { out[key] = compactValue(child, depth + 1, seen); } catch { out[key] = '[Unreadable]'; }
    }
    return out;
  }

  function persistRecentEvents() {
    try {
      safeStorageSet(EVENTS_KEY, JSON.stringify(events.slice(-MAX_PERSISTED_EVENTS)));
    } catch {}
  }

  function record(type, data = null, level = 'INFO') {
    const entry = {
      at: nowIso(),
      performanceMs: perfNow(),
      level,
      type,
      data: compactValue(data),
    };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    if (level === 'ERROR' || events.length % 20 === 0) persistRecentEvents();
    return entry;
  }

  function recordAppLog(message, level = 'INFO', data = null) {
    return record(`APP:${message}`, data, level);
  }

  function appApi() {
    return root.__ROOM_SCANNER_V20__ || root.__ROOM_SCANNER_V15__ || null;
  }

  function appStateSummary() {
    const api = appApi();
    const state = api?.state;
    if (!state) return null;
    return {
      version: api.VERSION || null,
      revision: api.REVISION || null,
      phase: state.phase,
      xr: {
        active: Boolean(state.session),
        starting: Boolean(state.xrStarting),
        normalEnding: Boolean(state.normalEnding),
        interrupted: Boolean(state.interrupted),
        trackingLost: Boolean(state.trackingLost),
        frameCount: state.frameCount,
        capabilities: compactValue(state.capabilities),
      },
      counts: {
        rooms: state.rooms?.length || 0,
        portals: state.portals?.length || 0,
        frames: state.frames?.length || 0,
        objects: state.objects?.length || 0,
        surfels: state.surfelMap?.map?.size ?? null,
        gaussians: state.geometryGaussians?.length || 0,
        rirManifests: state.audio?.manifests?.length || 0,
        rirAnalyses: state.rirAnalyses?.length || 0,
        acousticSurfaces: state.acousticSurfaces?.length || 0,
      },
      activeRoomId: state.activeRoomId,
      motion: compactValue(state.motion),
      currentCamera: compactValue(state.currentCamera),
      process: compactValue(state.process),
      audio: compactValue(state.audio),
      runtimeError: compactValue(state.runtimeError),
      handoff: {
        navigationExitPending: Boolean(state.navigationExitPending),
        postXrReady: Boolean(state.postXrReady),
        handoffPending: Boolean(state.handoffPending),
        checkpointSaving: Boolean(state.checkpointSaving),
        checkpointAvailable: Boolean(state.checkpointAvailable),
        checkpointLastSavedAt: state.checkpointLastSavedAt || null,
      },
    };
  }

  function writeSessionMarker(status = 'active', detail = null) {
    safeStorageSet(SESSION_KEY, JSON.stringify({
      sessionId,
      status,
      detail: compactValue(detail),
      at: nowIso(),
      app: appStateSummary(),
      eventCount: events.length,
    }));
  }

  function readPreviousMarkers() {
    try {
      const rawSession = safeStorageGet(SESSION_KEY);
      if (rawSession) previousSession = JSON.parse(rawSession);
    } catch { previousSession = null; }
    try {
      const rawEvents = safeStorageGet(EVENTS_KEY);
      const previousEvents = rawEvents ? JSON.parse(rawEvents) : [];
      if (Array.isArray(previousEvents) && previousEvents.length) {
        events.push(...previousEvents.slice(-MAX_PERSISTED_EVENTS).map(entry => ({ ...entry, recoveredFromPreviousSession: true })));
      }
    } catch {}
  }

  function pendingPreviousFailure() {
    if (!previousSession || previousSession.sessionId === sessionId) return null;
    if (previousSession.status === 'expected-close') return null;
    return previousSession;
  }

  function markExpectedClose(reason = 'expected-navigation') {
    expectedCloseReason = reason;
    record('EXPECTED_CLOSE_ARMED', { reason });
    writeSessionMarker('expected-close', { reason });
  }

  function markPageExit(reason) {
    const status = expectedCloseReason ? 'expected-close' : 'page-exit-unconfirmed';
    record('PAGE_EXIT', { reason, expectedCloseReason }, expectedCloseReason ? 'INFO' : 'WARN');
    persistRecentEvents();
    writeSessionMarker(status, { reason, expectedCloseReason });
  }

  function encodeBytesBase64(bytes) {
    if (!bytes?.byteLength) return '';
    const input = bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength || undefined);
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < input.length; index += chunk) {
      binary += String.fromCharCode(...input.subarray(index, Math.min(input.length, index + chunk)));
    }
    if (typeof root.btoa === 'function') return root.btoa(binary);
    if (typeof Buffer !== 'undefined') return Buffer.from(input).toString('base64');
    throw new Error('Base64 encoder unavailable');
  }

  function jsonSafe(value, seen = new WeakSet()) {
    if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return { __type: 'BigInt', value: String(value) };
    if (typeof value === 'function') return { __type: 'Function', name: value.name || 'anonymous' };
    if (value instanceof Error) return { __type: value.name || 'Error', message: value.message, stack: value.stack || null };
    if (value instanceof ArrayBuffer) return { __type: 'ArrayBuffer', byteLength: value.byteLength, base64: encodeBytesBase64(new Uint8Array(value)) };
    if (ArrayBuffer.isView(value)) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return { __type: value.constructor?.name || 'TypedArray', length: value.length ?? null, byteLength: value.byteLength, base64: encodeBytesBase64(bytes) };
    }
    if (typeof value !== 'object') return String(value);
    if (seen.has(value)) return { __type: 'CircularReference' };
    seen.add(value);
    if (value instanceof Map) return { __type: 'Map', entries: [...value.entries()].map(([key, child]) => [jsonSafe(key, seen), jsonSafe(child, seen)]) };
    if (value instanceof Set) return { __type: 'Set', values: [...value].map(child => jsonSafe(child, seen)) };
    if (Array.isArray(value)) return value.map(child => jsonSafe(child, seen));
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      try { out[key] = jsonSafe(child, seen); } catch (error) { out[key] = { __type: 'SerializationError', message: errorText(error) }; }
    }
    return out;
  }

  function browserEnvironment() {
    const nav = root.navigator || {};
    const connection = nav.connection || nav.mozConnection || nav.webkitConnection;
    return {
      diagnosticBuild: BUILD,
      sessionId,
      exportedAt: nowIso(),
      location: root.location ? { href: root.location.href, origin: root.location.origin, pathname: root.location.pathname } : null,
      userAgent: nav.userAgent || null,
      platform: nav.platform || null,
      language: nav.language || null,
      languages: nav.languages || null,
      hardwareConcurrency: nav.hardwareConcurrency || null,
      deviceMemoryGB: nav.deviceMemory || null,
      maxTouchPoints: nav.maxTouchPoints || null,
      online: nav.onLine ?? null,
      connection: connection ? {
        effectiveType: connection.effectiveType || null,
        downlink: connection.downlink ?? null,
        rtt: connection.rtt ?? null,
        saveData: connection.saveData ?? null,
      } : null,
      screen: root.screen ? {
        width: root.screen.width,
        height: root.screen.height,
        availWidth: root.screen.availWidth,
        availHeight: root.screen.availHeight,
        colorDepth: root.screen.colorDepth,
        pixelDepth: root.screen.pixelDepth,
        orientation: root.screen.orientation?.type || null,
      } : null,
      viewport: { width: root.innerWidth ?? null, height: root.innerHeight ?? null, devicePixelRatio: root.devicePixelRatio ?? null },
      secureContext: root.isSecureContext ?? null,
      crossOriginIsolated: root.crossOriginIsolated ?? null,
      visibilityState: root.document?.visibilityState || null,
      performanceMemory: root.performance?.memory ? {
        jsHeapSizeLimit: root.performance.memory.jsHeapSizeLimit,
        totalJSHeapSize: root.performance.memory.totalJSHeapSize,
        usedJSHeapSize: root.performance.memory.usedJSHeapSize,
      } : null,
    };
  }

  async function storageEnvironment() {
    let estimate = null;
    try { estimate = await root.navigator?.storage?.estimate?.(); } catch {}
    let persisted = null;
    try { persisted = await root.navigator?.storage?.persisted?.(); } catch {}
    let caches = [];
    try { caches = await root.caches?.keys?.() || []; } catch {}
    let registrations = [];
    try {
      registrations = (await root.navigator?.serviceWorker?.getRegistrations?.() || []).map(registration => ({
        scope: registration.scope,
        active: registration.active?.scriptURL || null,
        waiting: registration.waiting?.scriptURL || null,
        installing: registration.installing?.scriptURL || null,
      }));
    } catch {}
    return { estimate, persisted, caches, serviceWorkers: registrations };
  }

  function performanceSnapshot() {
    try {
      return (root.performance?.getEntries?.() || []).slice(-500).map(entry => ({
        name: entry.name,
        entryType: entry.entryType,
        startTime: entry.startTime,
        duration: entry.duration,
        initiatorType: entry.initiatorType || null,
        transferSize: entry.transferSize ?? null,
        encodedBodySize: entry.encodedBodySize ?? null,
        decodedBodySize: entry.decodedBodySize ?? null,
        nextHopProtocol: entry.nextHopProtocol || null,
      }));
    } catch { return []; }
  }

  function openDatabaseExisting(name) {
    if (!root.indexedDB) return Promise.resolve(null);
    return new Promise(resolve => {
      try {
        const request = root.indexedDB.open(name);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
        request.onupgradeneeded = () => {
          // Opening a missing DB would create an empty shell. Abort so the
          // diagnostics module never mutates application storage.
          try { request.transaction?.abort?.(); } catch {}
          try { request.result?.close?.(); } catch {}
          resolve(null);
        };
      } catch { resolve(null); }
    });
  }

  function readStoreAll(database, storeName) {
    if (!database?.objectStoreNames?.contains?.(storeName)) return Promise.resolve([]);
    return new Promise(resolve => {
      try {
        const transaction = database.transaction(storeName, 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve([]);
        transaction.onabort = () => resolve([]);
      } catch { resolve([]); }
    });
  }

  async function persistedRecords() {
    const result = { checkpoints: [], acousticMeasurements: [], acousticMetadata: [] };
    const checkpointDb = await openDatabaseExisting('room-scanner-v20-1-checkpoints');
    if (checkpointDb) {
      result.checkpoints = await readStoreAll(checkpointDb, 'snapshots');
      try { checkpointDb.close(); } catch {}
    }
    const acousticDb = await openDatabaseExisting('room-scanner-v20-acoustic-captures');
    if (acousticDb) {
      result.acousticMeasurements = await readStoreAll(acousticDb, 'measurements');
      result.acousticMetadata = await readStoreAll(acousticDb, 'metadata');
      try { acousticDb.close(); } catch {}
    }
    return result;
  }

  async function* diagnosticRecords(options = {}) {
    const api = appApi();
    const state = api?.state;
    yield { type: 'diagnostic-header', data: {
      schema: 'room-scanner-v20-diagnostic-jsonl-v1',
      diagnosticBuild: BUILD,
      trigger: options.trigger || 'manual',
      reason: options.reason || null,
      sessionId,
      generatedAt: nowIso(),
      previousSession,
    } };
    yield { type: 'environment', data: browserEnvironment() };
    yield { type: 'storage-environment', data: await storageEnvironment() };
    yield { type: 'performance-entries', data: performanceSnapshot() };
    yield { type: 'diagnostic-events', data: events };
    yield { type: 'application-logs', data: state?.logs || [] };
    yield { type: 'application-state-summary', data: appStateSummary() };

    if (api?.buildRawSnapshot) {
      try {
        const raw = api.buildRawSnapshot();
        // Split the RAW by top-level key so a large scan does not require a
        // second monolithic JSON string in memory before compression.
        for (const [key, value] of Object.entries(raw || {})) {
          if (Array.isArray(value) && value.length > 24) {
            yield { type: 'raw-array-header', key, count: value.length };
            for (let index = 0; index < value.length; index += 1) yield { type: 'raw-array-item', key, index, data: value[index] };
          } else {
            yield { type: 'raw-section', key, data: value };
          }
        }
      } catch (error) {
        yield { type: 'raw-snapshot-error', data: { message: errorText(error), stack: error?.stack || null } };
      }
    } else {
      yield { type: 'raw-snapshot-unavailable', data: { reason: 'application-api-not-ready' } };
    }

    const persisted = await persistedRecords();
    yield { type: 'indexeddb-checkpoint-count', data: { count: persisted.checkpoints.length } };
    for (let index = 0; index < persisted.checkpoints.length; index += 1) {
      yield { type: 'indexeddb-checkpoint-record', index, data: persisted.checkpoints[index] };
    }
    yield { type: 'indexeddb-acoustic-count', data: { measurements: persisted.acousticMeasurements.length, metadata: persisted.acousticMetadata.length } };
    for (let index = 0; index < persisted.acousticMeasurements.length; index += 1) {
      // PCM Int16 is preserved losslessly as base64 by jsonSafe().
      yield { type: 'indexeddb-acoustic-measurement', index, data: persisted.acousticMeasurements[index] };
    }
    for (let index = 0; index < persisted.acousticMetadata.length; index += 1) {
      yield { type: 'indexeddb-acoustic-metadata', index, data: persisted.acousticMetadata[index] };
    }
  }

  function recordsToStream(options = {}) {
    const encoder = new TextEncoder();
    const iterator = diagnosticRecords(options)[Symbol.asyncIterator]();
    return new ReadableStream({
      async pull(controller) {
        try {
          const { value, done } = await iterator.next();
          if (done) {
            controller.close();
            return;
          }
          const safe = jsonSafe(value);
          controller.enqueue(encoder.encode(`${JSON.stringify(safe)}\n`));
        } catch (error) {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'diagnostic-stream-error', data: { message: errorText(error) } })}\n`));
          controller.close();
        }
      },
      async cancel() {
        try { await iterator.return?.(); } catch {}
      },
    });
  }

  function downloadBlob(blob, filename) {
    if (!root.document?.createElement || !root.URL?.createObjectURL) return false;
    const url = root.URL.createObjectURL(blob);
    const anchor = root.document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    root.document.body?.appendChild(anchor);
    anchor.click();
    anchor.remove?.();
    setTimeout(() => root.URL.revokeObjectURL(url), 10000);
    return true;
  }

  async function exportBundle(options = {}) {
    record('DIAGNOSTIC_EXPORT_STARTED', { trigger: options.trigger || 'manual', reason: options.reason || null });
    let stream = recordsToStream(options);
    let extension = 'jsonl';
    let mime = 'application/x-ndjson';
    if (typeof root.CompressionStream === 'function') {
      try {
        stream = stream.pipeThrough(new root.CompressionStream('gzip'));
        extension = 'jsonl.gz';
        mime = 'application/gzip';
      } catch (error) {
        record('DIAGNOSTIC_GZIP_FALLBACK', { error: errorText(error) }, 'WARN');
      }
    }
    const blob = await new Response(stream, { headers: { 'Content-Type': mime } }).blob();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `room_scan_diagnostic_v20_1_${stamp}.${extension}`;
    const downloaded = downloadBlob(blob, filename);
    record('DIAGNOSTIC_EXPORT_FINISHED', { filename, bytes: blob.size, downloaded });
    safeStorageRemove(FAULT_KEY);
    persistRecentEvents();
    return { filename, bytes: blob.size, downloaded, blob };
  }

  function faultDescriptor(error, source, context = null) {
    return {
      source,
      message: errorText(error),
      name: error?.name || null,
      stack: error?.stack || null,
      context: compactValue(context),
      app: appStateSummary(),
      at: nowIso(),
      sessionId,
    };
  }

  function setPendingFault(fault) {
    try { safeStorageSet(FAULT_KEY, JSON.stringify(fault)); } catch {}
  }

  function readPendingFault() {
    try {
      const value = safeStorageGet(FAULT_KEY);
      return value ? JSON.parse(value) : null;
    } catch { return null; }
  }

  function captureFault(error, source = 'UNEXPECTED', context = null) {
    const fault = faultDescriptor(error, source, context);
    const signature = `${fault.source}|${fault.message}`;
    const timestamp = Date.now();
    // The app and the global window handler can observe the same exception.
    // Keep one diagnostic fault/prompt while retaining later distinct errors.
    if (signature === lastFaultSignature && timestamp - lastFaultAt < 1200) return fault;
    lastFaultSignature = signature;
    lastFaultAt = timestamp;
    record('FAULT_CAPTURED', fault, 'ERROR');
    setPendingFault(fault);
    const timer = setTimeout(() => { maybePrompt({ fault }).catch(() => {}); }, 80);
    timer?.unref?.();
    return fault;
  }

  async function maybePrompt(options = {}) {
    if (promptActive || typeof root.confirm !== 'function') return false;
    const api = appApi();
    if (api?.state?.session || api?.state?.handoffPending || api?.state?.checkpointSaving) return false;
    const fault = options.fault || readPendingFault();
    const previous = pendingPreviousFailure();
    if (!fault && !previous) return false;
    promptActive = true;
    try {
      const previousText = previous
        ? `\nLa sessione precedente risulta terminata senza una chiusura diagnostica confermata (${previous.status}).`
        : '';
      const faultText = fault ? `\nErrore: ${fault.source || 'UNEXPECTED'} · ${fault.message || 'errore sconosciuto'}` : '';
      const accepted = root.confirm(
        `Room Scanner ha rilevato una condizione utile per il debug.${faultText}${previousText}\n\nEsportare ora il bundle diagnostico completo (log, stato, geometria, foto persistite e PCM/RIR disponibili)?`,
      );
      if (accepted) {
        await exportBundle({ trigger: fault ? 'automatic-fault-confirmed' : 'previous-session-recovery', reason: fault?.source || previous?.status || 'unknown' });
        previousSession = null;
        writeSessionMarker('active', { recoveredDiagnosticExport: true });
      } else {
        record('DIAGNOSTIC_EXPORT_DECLINED', { fault, previous }, 'WARN');
      }
      return accepted;
    } finally {
      promptActive = false;
    }
  }

  function appReady() {
    appReadySeen = true;
    record('APP_READY', appStateSummary());
    writeSessionMarker('active', { appReady: true });
    const timer = setTimeout(() => { maybePrompt().catch(() => {}); }, 450);
    timer?.unref?.();
  }

  function patchConsole() {
    if (consolePatched || !root.console) return;
    consolePatched = true;
    for (const level of ['warn', 'error']) {
      const original = root.console[level]?.bind(root.console);
      if (!original) continue;
      root.console[level] = (...args) => {
        record(`CONSOLE_${level.toUpperCase()}`, args, level === 'error' ? 'ERROR' : 'WARN');
        return original(...args);
      };
    }
  }

  function patchFetch() {
    if (fetchPatched || typeof root.fetch !== 'function') return;
    fetchPatched = true;
    const original = root.fetch.bind(root);
    root.fetch = async (...args) => {
      const started = perfNow();
      const request = args[0];
      const url = typeof request === 'string' ? request : request?.url || String(request || '');
      try {
        const response = await original(...args);
        if (!response.ok) record('FETCH_HTTP_ERROR', { url, status: response.status, statusText: response.statusText, durationMs: perfNow() - started }, 'WARN');
        return response;
      } catch (error) {
        record('FETCH_FAILED', { url, durationMs: perfNow() - started, error: errorText(error) }, 'ERROR');
        throw error;
      }
    };
  }

  function install() {
    if (installed) return;
    installed = true;
    readPreviousMarkers();
    record('DIAGNOSTICS_INSTALLED', { build: BUILD, previousSession });
    writeSessionMarker('active', { installed: true });
    patchConsole();
    patchFetch();

    root.addEventListener?.('error', event => {
      const error = event.error || new Error(event.message || 'window error');
      captureFault(error, 'WINDOW_UNCAUGHT', {
        filename: event.filename || null,
        lineno: event.lineno || null,
        colno: event.colno || null,
      });
    }, true);
    root.addEventListener?.('unhandledrejection', event => captureFault(event.reason || new Error('Unhandled rejection'), 'UNHANDLED_REJECTION'), true);
    root.addEventListener?.('pagehide', event => markPageExit(event.persisted ? 'pagehide-bfcache' : 'pagehide'), true);
    root.addEventListener?.('beforeunload', () => {
      // No confirm here: modern browsers ignore custom unload prompts and a
      // download cannot be trusted to complete. The next launch handles it.
      writeSessionMarker(expectedCloseReason ? 'expected-close' : 'beforeunload-unconfirmed', { expectedCloseReason });
      persistRecentEvents();
    }, true);
    root.addEventListener?.('pageshow', event => record('PAGE_SHOW', { persisted: Boolean(event.persisted) }));
    root.addEventListener?.('online', () => record('NETWORK_ONLINE'));
    root.addEventListener?.('offline', () => record('NETWORK_OFFLINE', null, 'WARN'));
    root.document?.addEventListener?.('visibilitychange', () => record('VISIBILITY', { state: root.document.visibilityState }));
    root.document?.addEventListener?.('freeze', () => { record('DOCUMENT_FREEZE', null, 'WARN'); persistRecentEvents(); });
    root.document?.addEventListener?.('resume', () => record('DOCUMENT_RESUME'));

    // If the app never calls appReady (e.g. initialization itself fails), still
    // offer a previous-session diagnostic export once the document settles.
    const timer = setTimeout(() => {
      if (!appReadySeen) maybePrompt().catch(() => {});
    }, 1800);
    timer?.unref?.();
  }

  return {
    BUILD,
    sessionId,
    events,
    install,
    record,
    recordAppLog,
    captureFault,
    maybePrompt,
    appReady,
    markExpectedClose,
    exportBundle,
    appStateSummary,
    browserEnvironment,
    persistedRecords,
    jsonSafe,
    diagnosticRecords,
  };
});
