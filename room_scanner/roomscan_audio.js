/*
 * Room Scanner V20.1.0 - smartphone acoustic acquisition controller
 * -------------------------------------------------------------------------
 * Live responsibilities are intentionally small:
 *   - request unprocessed microphone capture where the browser permits it;
 *   - keep a continuous PCM timeline in an AudioWorklet;
 *   - schedule short ESS sweeps and store timing/pose metadata;
 *   - retain only bounded PCM around each sweep;
 *   - persist each measurement separately after WebXR has released resources.
 *
 * Correlation, Kirkeby inversion, echo detection and surface inference are
 * strictly post-XR operations implemented by RoomScanSignal/RoomScanAcoustics.
 */
(function attachRoomScanAudio(root, factory) {
  const signal = root.RoomScanSignal || (typeof require === 'function' ? require('./roomscan_signal_v20_1_0.js') : null);
  const api = factory(signal);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.RoomScanAudio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function roomScanAudioFactory(S) {
  'use strict';

  if (!S) throw new Error('RoomScanSignal is required by RoomScanAudio');

  const DB_NAME = 'room-scanner-v20-acoustic-captures';
  const DB_VERSION = 1;
  const STORE_NAME = 'measurements';
  const META_STORE_NAME = 'metadata';
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

  function nowPerformance() {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  function openAudioDatabase(indexedDB = globalThis.indexedDB) {
    if (!indexedDB) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        if (!database.objectStoreNames.contains(META_STORE_NAME)) database.createObjectStore(META_STORE_NAME, { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Acoustic IndexedDB unavailable'));
      request.onblocked = () => reject(new Error('Acoustic IndexedDB blocked by another tab'));
    });
  }

  function transaction(database, storeName, mode, action) {
    return new Promise((resolve, reject) => {
      try {
        const tx = database.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let output;
        action(store, value => { output = value; });
        tx.oncomplete = () => resolve(output);
        tx.onerror = () => reject(tx.error || new Error('Acoustic database transaction failed'));
        tx.onabort = () => reject(tx.error || new Error('Acoustic database transaction aborted'));
      } catch (error) {
        reject(error);
      }
    });
  }

  function quaternionFromMatrix(matrix) {
    if (!matrix || matrix.length < 16) return null;
    const m00 = matrix[0]; const m01 = matrix[4]; const m02 = matrix[8];
    const m10 = matrix[1]; const m11 = matrix[5]; const m12 = matrix[9];
    const m20 = matrix[2]; const m21 = matrix[6]; const m22 = matrix[10];
    const trace = m00 + m11 + m22;
    let x; let y; let z; let w;
    if (trace > 0) {
      const s = Math.sqrt(trace + 1) * 2;
      w = 0.25 * s;
      x = (m21 - m12) / s;
      y = (m02 - m20) / s;
      z = (m10 - m01) / s;
    } else if (m00 > m11 && m00 > m22) {
      const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
      w = (m21 - m12) / s;
      x = 0.25 * s;
      y = (m01 + m10) / s;
      z = (m02 + m20) / s;
    } else if (m11 > m22) {
      const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
      w = (m02 - m20) / s;
      x = (m01 + m10) / s;
      y = 0.25 * s;
      z = (m12 + m21) / s;
    } else {
      const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
      w = (m10 - m01) / s;
      x = (m02 + m20) / s;
      y = (m12 + m21) / s;
      z = 0.25 * s;
    }
    return S.quaternionSlerp([x, y, z, w], [x, y, z, w], 0);
  }

  function rotateVectorByQuaternion(vector, quaternion) {
    if (!vector || !quaternion) return vector ? [...vector] : null;
    const [x, y, z, w] = quaternion;
    const [vx, vy, vz] = vector;
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    return [
      vx + w * tx + (y * tz - z * ty),
      vy + w * ty + (z * tx - x * tz),
      vz + w * tz + (x * ty - y * tx),
    ];
  }

  function compactPose(poseMatrix, performanceTime, confidence = 1) {
    if (!poseMatrix || poseMatrix.length < 16) return null;
    return {
      t: performanceTime,
      p: [poseMatrix[12], poseMatrix[13], poseMatrix[14]],
      q: quaternionFromMatrix(poseMatrix),
      confidence,
    };
  }

  class AcousticCaptureController {
    constructor(options = {}) {
      this.options = {
        workletUrl: options.workletUrl || './roomscan_audio_worklet_v20_1_0.js',
        sampleRate: options.sampleRate || 48000,
        sweepF0: options.sweepF0 || 120,
        sweepF1: options.sweepF1 || 15000,
        sweepDurationSeconds: options.sweepDurationSeconds || 0.32,
        sweepAmplitude: options.sweepAmplitude || 0.52,
        sweepFadeSeconds: options.sweepFadeSeconds || 0.018,
        scheduleLeadSeconds: options.scheduleLeadSeconds || 0.14,
        preRollSeconds: options.preRollSeconds || 0.62,
        tailSeconds: options.tailSeconds || 2.65,
        maximumLatencySeconds: options.maximumLatencySeconds || 0.75,
        ringSeconds: options.ringSeconds || 6.5,
        chunkFrames: options.chunkFrames || 4096,
        maximumMeasurements: options.maximumMeasurements || 96,
        ...options,
      };
      this.context = null;
      this.stream = null;
      this.track = null;
      this.sourceNode = null;
      this.captureNode = null;
      this.keepAliveGain = null;
      this.outputGain = null;
      this.sampleRate = this.options.sampleRate;
      this.sweep = null;
      this.sweepBuffer = null;
      this.chunks = [];
      this.pending = new Map();
      this.measurements = [];
      this.sequence = 0;
      this.clockSamples = [];
      this.clockMap = null;
      this.clockTimer = null;
      this.meter = { rms: 0, peak: 0, frame: 0 };
      this.status = 'idle';
      this.audioSettings = {};
      this.audioCapabilities = {};
      this.contextCreation = { requestedSampleRate: this.options.sampleRate, usedFallback: false };
      this.events = new Map();
      this.databasePromise = null;
      this.persistedIds = new Set();
      this.schedulingFrozen = false;
      this.lastSweepPerformanceTime = -Infinity;
      this.diagnostics = [];
    }

    on(type, listener) {
      if (!this.events.has(type)) this.events.set(type, new Set());
      this.events.get(type).add(listener);
      return () => this.events.get(type)?.delete(listener);
    }

    emit(type, payload) {
      for (const listener of this.events.get(type) || []) {
        try { listener(payload); } catch (error) { this.log('listener-error', { type, error: error?.message || String(error) }); }
      }
    }

    log(event, data = {}) {
      const entry = { time: new Date().toISOString(), event, ...data };
      this.diagnostics.push(entry);
      if (this.diagnostics.length > 300) this.diagnostics.splice(0, this.diagnostics.length - 300);
      this.emit('diagnostic', entry);
      return entry;
    }

    async prepare() {
      if (this.status === 'ready' || this.status === 'recording') return this.summary();
      if (!globalThis.navigator?.mediaDevices?.getUserMedia) throw new Error('Microphone capture is not available');
      const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextClass) throw new Error('Web Audio is not available');
      this.status = 'preparing';
      this.emit('status', this.status);
      const constraints = {
        audio: {
          channelCount: { ideal: 1 },
          sampleRate: { ideal: this.options.sampleRate },
          sampleSize: { ideal: 16 },
          echoCancellation: { exact: false },
          noiseSuppression: { exact: false },
          autoGainControl: { exact: false },
        },
        video: false,
      };
      try {
        this.stream = await globalThis.navigator.mediaDevices.getUserMedia(constraints);
      } catch (strictError) {
        this.log('strict-audio-constraints-rejected', { error: strictError?.message || String(strictError) });
        this.stream = await globalThis.navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: { ideal: 1 },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
        });
      }
      this.track = this.stream.getAudioTracks()[0];
      this.audioSettings = this.track?.getSettings?.() || {};
      this.audioCapabilities = this.track?.getCapabilities?.() || {};
      try {
        this.context = new AudioContextClass({ latencyHint: 'interactive', sampleRate: this.options.sampleRate });
      } catch (error) {
        // Some Android audio routes expose only their native sample rate and
        // reject an explicit AudioContext sampleRate. Fall back to the route's
        // native rate; every ESS and RIR descriptor stores the actual rate.
        this.contextCreation.usedFallback = true;
        this.contextCreation.fallbackReason = error?.message || String(error);
        this.context = new AudioContextClass({ latencyHint: 'interactive' });
      }
      await this.context.resume();
      this.sampleRate = this.context.sampleRate;
      await this.context.audioWorklet.addModule(this.options.workletUrl);
      this.sourceNode = this.context.createMediaStreamSource(this.stream);
      this.captureNode = new AudioWorkletNode(this.context, 'roomscan-pcm-capture-v20-1', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        processorOptions: { chunkFrames: this.options.chunkFrames },
      });
      this.keepAliveGain = this.context.createGain();
      this.keepAliveGain.gain.value = 0;
      this.outputGain = this.context.createGain();
      this.outputGain.gain.value = 1;
      this.sourceNode.connect(this.captureNode);
      this.captureNode.connect(this.keepAliveGain).connect(this.context.destination);
      this.outputGain.connect(this.context.destination);
      this.captureNode.port.onmessage = event => this.handleWorkletMessage(event.data);
      this.sweepDescriptor = S.generateESS(
        this.sampleRate,
        this.options.sweepF0,
        Math.min(this.options.sweepF1, this.sampleRate * 0.44),
        this.options.sweepDurationSeconds,
        this.options.sweepAmplitude,
        this.options.sweepFadeSeconds,
      );
      this.sweep = this.sweepDescriptor.samples instanceof Float32Array
        ? this.sweepDescriptor.samples
        : Float32Array.from(this.sweepDescriptor.samples || this.sweepDescriptor || []);
      if (!this.sweep.length) throw new Error('ESS generator returned an empty waveform');
      this.sweepBuffer = this.context.createBuffer(1, this.sweep.length, this.sampleRate);
      this.sweepBuffer.copyToChannel(this.sweep, 0);
      this.status = 'ready';
      this.schedulingFrozen = false;
      this.sampleClock();
      this.clockTimer = setInterval(() => this.sampleClock(), 260);
      this.emit('status', this.status);
      this.log('audio-ready', {
        sampleRate: this.sampleRate,
        settings: this.audioSettings,
        capabilities: this.audioCapabilities,
        contextCreation: { ...this.contextCreation, actualSampleRate: this.sampleRate },
        baseLatency: this.context.baseLatency ?? null,
        outputLatency: this.context.outputLatency ?? null,
      });
      return this.summary();
    }

    handleWorkletMessage(message) {
      if (message?.type === 'meter') {
        this.meter = { rms: message.rms || 0, peak: message.peak || 0, frame: message.frame || 0 };
        this.emit('meter', this.meter);
        return;
      }
      if (message?.type !== 'pcm' || !message.samples) return;
      const samples = message.samples instanceof Float32Array ? message.samples : new Float32Array(message.samples);
      const chunk = {
        startFrame: Number(message.startFrame) || 0,
        endFrame: (Number(message.startFrame) || 0) + samples.length,
        samples,
      };
      this.chunks.push(chunk);
      this.pruneChunks();
      this.finalizeReadyPending();
    }

    sampleClock() {
      if (!this.context) return null;
      const performanceTime = nowPerformance();
      const contextTime = this.context.currentTime;
      let outputTimestamp = null;
      try { outputTimestamp = this.context.getOutputTimestamp?.() || null; } catch {}
      const sample = {
        contextTime,
        performanceTime,
        outputContextTime: Number(outputTimestamp?.contextTime) || null,
        outputPerformanceTime: Number(outputTimestamp?.performanceTime) || null,
      };
      this.clockSamples.push(sample);
      if (this.clockSamples.length > 80) this.clockSamples.shift();
      const fit = S.fitClockMap(this.clockSamples.map(item => ({
        contextTime: item.outputContextTime ?? item.contextTime,
        performanceTime: item.outputPerformanceTime ?? item.performanceTime,
      })));
      // Never keep the callable helpers returned by fitClockMap in acquisition
      // state. Function values are not structured-cloneable and caused a
      // DataCloneError while IndexedDB persisted the last RIR at XR shutdown.
      this.clockMap = fit ? {
        slope: fit.slopeMsPerSecond,
        intercept: fit.interceptMs,
        residualMadMs: fit.residualMadMs,
        residualP95Ms: fit.residualP95Ms,
        sampleCount: fit.sampleCount,
        r2: fit.r2,
      } : null;
      return sample;
    }

    contextToPerformance(contextTime) {
      if (this.clockMap && Number.isFinite(this.clockMap.slope) && Number.isFinite(this.clockMap.intercept)) {
        return this.clockMap.slope * contextTime + this.clockMap.intercept;
      }
      if (!this.context) return nowPerformance();
      return nowPerformance() + (contextTime - this.context.currentTime) * 1000;
    }

    performanceToContext(performanceTime) {
      if (this.clockMap && Number.isFinite(this.clockMap.slope) && Math.abs(this.clockMap.slope) > 1e-6) {
        return (performanceTime - this.clockMap.intercept) / this.clockMap.slope;
      }
      if (!this.context) return 0;
      return this.context.currentTime + (performanceTime - nowPerformance()) / 1000;
    }

    scheduleSweep(metadata = {}) {
      if (this.status !== 'ready' && this.status !== 'recording') throw new Error('Audio capture is not ready');
      if (this.schedulingFrozen) return null;
      if (this.measurements.length + this.pending.size >= this.options.maximumMeasurements) return null;
      const currentPerformanceTime = nowPerformance();
      const minimumGapMs = metadata.minimumGapMs || 900;
      if (currentPerformanceTime - this.lastSweepPerformanceTime < minimumGapMs) return null;
      const scheduledContextTime = Math.max(
        this.context.currentTime + this.options.scheduleLeadSeconds,
        Number(metadata.contextTime) || 0,
      );
      const expectedOutputFrame = Math.round(scheduledContextTime * this.sampleRate);
      const id = metadata.id || `rir-${++this.sequence}`;
      const source = this.context.createBufferSource();
      source.buffer = this.sweepBuffer;
      source.connect(this.outputGain);
      source.start(scheduledContextTime);
      const scheduledPerformanceTime = this.contextToPerformance(scheduledContextTime);
      const preFrames = Math.round(this.options.preRollSeconds * this.sampleRate);
      const postFrames = Math.round((this.options.sweepDurationSeconds + this.options.tailSeconds + this.options.maximumLatencySeconds) * this.sampleRate);
      const pending = {
        id,
        scheduledContextTime,
        scheduledPerformanceTime,
        expectedOutputFrame,
        captureStartFrame: expectedOutputFrame - preFrames,
        captureEndFrame: expectedOutputFrame + postFrames,
        roomId: metadata.roomId ?? null,
        sourceMode: metadata.sourceMode || 'monostatic',
        sourcePosition: metadata.sourcePosition ? [...metadata.sourcePosition] : null,
        receiverPoseAtSchedule: metadata.receiverPose || compactPose(metadata.poseMatrix, scheduledPerformanceTime, metadata.poseConfidence),
        receiverPosition: metadata.receiverPosition ? [...metadata.receiverPosition] : null,
        poseConfidence: metadata.poseConfidence ?? 1,
        viewId: metadata.viewId ?? null,
        label: metadata.label || null,
        metadata: metadata.metadata || {},
        outputLatencySeconds: this.context.outputLatency ?? null,
        baseLatencySeconds: this.context.baseLatency ?? null,
        audioSettings: { ...this.audioSettings },
        audioCapabilities: { ...this.audioCapabilities },
        contextCreation: { ...this.contextCreation, actualSampleRate: this.sampleRate },
        finalized: false,
      };
      this.pending.set(id, pending);
      this.lastSweepPerformanceTime = currentPerformanceTime;
      this.status = 'recording';
      source.onended = () => this.finalizeReadyPending();
      this.emit('sweep', { id, scheduledPerformanceTime, roomId: pending.roomId });
      this.log('sweep-scheduled', { id, roomId: pending.roomId, scheduledContextTime, expectedOutputFrame });
      return { ...pending };
    }

    latestCapturedFrame() {
      return this.chunks.length ? this.chunks[this.chunks.length - 1].endFrame : 0;
    }

    earliestCapturedFrame() {
      return this.chunks.length ? this.chunks[0].startFrame : Infinity;
    }

    extractFrameRange(startFrame, endFrame) {
      const length = Math.max(0, Math.round(endFrame - startFrame));
      const output = new Float32Array(length);
      let copied = 0;
      for (const chunk of this.chunks) {
        const overlapStart = Math.max(startFrame, chunk.startFrame);
        const overlapEnd = Math.min(endFrame, chunk.endFrame);
        if (overlapEnd <= overlapStart) continue;
        const sourceOffset = Math.round(overlapStart - chunk.startFrame);
        const targetOffset = Math.round(overlapStart - startFrame);
        const count = Math.round(overlapEnd - overlapStart);
        output.set(chunk.samples.subarray(sourceOffset, sourceOffset + count), targetOffset);
        copied += count;
      }
      return { samples: output, coverage: length ? copied / length : 0 };
    }

    finalizeReadyPending(force = false) {
      const latest = this.latestCapturedFrame();
      const finalized = [];
      for (const pending of [...this.pending.values()]) {
        if (!force && latest < pending.captureEndFrame) continue;
        const actualEnd = force ? Math.min(pending.captureEndFrame, latest) : pending.captureEndFrame;
        if (actualEnd <= pending.captureStartFrame) continue;
        const extracted = this.extractFrameRange(pending.captureStartFrame, actualEnd);
        const record = {
          id: pending.id,
          schema: 'room-scanner-acoustic-measurement-v2',
          sampleRate: this.sampleRate,
          recording: S.floatToInt16(extracted.samples),
          recordingStartFrame: pending.captureStartFrame,
          expectedOnsetSample: pending.expectedOutputFrame - pending.captureStartFrame,
          scheduledContextTime: pending.scheduledContextTime,
          scheduledPerformanceTime: pending.scheduledPerformanceTime,
          roomId: pending.roomId,
          sourceMode: pending.sourceMode,
          sourcePosition: pending.sourcePosition,
          receiverPoseAtSchedule: pending.receiverPoseAtSchedule,
          receiverPosition: pending.receiverPosition || pending.receiverPoseAtSchedule?.p || null,
          poseConfidence: pending.poseConfidence,
          viewId: pending.viewId,
          label: pending.label,
          metadata: pending.metadata,
          sweepConfig: {
            f0: this.options.sweepF0,
            f1: Math.min(this.options.sweepF1, this.sampleRate * 0.44),
            durationSeconds: this.options.sweepDurationSeconds,
            amplitude: this.options.sweepAmplitude,
            fadeSeconds: this.options.sweepFadeSeconds,
          },
          outputLatencySeconds: pending.outputLatencySeconds,
          baseLatencySeconds: pending.baseLatencySeconds,
          audioSettings: pending.audioSettings,
          audioCapabilities: pending.audioCapabilities,
          contextCreation: pending.contextCreation,
          clockMap: this.clockMap ? { ...this.clockMap } : null,
          clockSamples: this.clockSamples.slice(-20),
          captureCoverage: extracted.coverage,
          finalizedEarly: actualEnd < pending.captureEndFrame,
          createdAt: new Date().toISOString(),
        };
        this.measurements.push(record);
        this.pending.delete(pending.id);
        finalized.push(record);
        this.emit('measurement', this.measurementManifest(record));
        this.log('measurement-finalized', { id: record.id, samples: record.recording.length, coverage: record.captureCoverage });
      }
      if (!this.pending.size && this.status === 'recording') this.status = 'ready';
      this.pruneChunks();
      return finalized;
    }

    pruneChunks() {
      const latest = this.latestCapturedFrame();
      let keepFrom = latest - Math.round(this.options.ringSeconds * this.sampleRate);
      for (const pending of this.pending.values()) keepFrom = Math.min(keepFrom, pending.captureStartFrame);
      while (this.chunks.length && this.chunks[0].endFrame < keepFrom) this.chunks.shift();
    }

    freezeScheduling() {
      this.schedulingFrozen = true;
      this.log('scheduling-frozen');
    }

    resumeScheduling() {
      this.schedulingFrozen = false;
      this.log('scheduling-resumed');
    }

    async flushPending(options = {}) {
      this.freezeScheduling();
      try { this.captureNode?.port?.postMessage?.({ command: 'flush' }); } catch {}
      const maximumWaitMs = options.maximumWaitMs ?? 3200;
      const start = Date.now();
      while (this.pending.size && Date.now() - start < maximumWaitMs) {
        this.finalizeReadyPending(false);
        if (!this.pending.size) break;
        await new Promise(resolve => setTimeout(resolve, 90));
      }
      this.finalizeReadyPending(true);
      return this.measurements.length;
    }

    measurementManifest(record) {
      return {
        id: record.id,
        schema: record.schema,
        sampleRate: record.sampleRate,
        samples: record.recording?.length || 0,
        roomId: record.roomId,
        sourceMode: record.sourceMode,
        sourcePosition: record.sourcePosition,
        receiverPoseAtSchedule: record.receiverPoseAtSchedule,
        receiverPosition: record.receiverPosition,
        poseConfidence: record.poseConfidence,
        viewId: record.viewId,
        label: record.label,
        metadata: record.metadata,
        sweepConfig: record.sweepConfig,
        recordingStartFrame: record.recordingStartFrame,
        expectedOnsetSample: record.expectedOnsetSample,
        scheduledContextTime: record.scheduledContextTime,
        scheduledPerformanceTime: record.scheduledPerformanceTime,
        outputLatencySeconds: record.outputLatencySeconds,
        baseLatencySeconds: record.baseLatencySeconds,
        audioSettings: record.audioSettings,
        audioCapabilities: record.audioCapabilities || null,
        contextCreation: record.contextCreation || null,
        clockMap: record.clockMap,
        captureCoverage: record.captureCoverage,
        finalizedEarly: record.finalizedEarly,
        createdAt: record.createdAt,
        storageKey: record.id,
      };
    }

    regenerateSweep(record) {
      const config = record.sweepConfig || {};
      const descriptor = S.generateESS(
        record.sampleRate || this.sampleRate,
        config.f0 || this.options.sweepF0,
        config.f1 || this.options.sweepF1,
        config.durationSeconds || this.options.sweepDurationSeconds,
        config.amplitude || this.options.sweepAmplitude,
        config.fadeSeconds || this.options.sweepFadeSeconds,
      );
      return descriptor.samples instanceof Float32Array
        ? descriptor.samples
        : Float32Array.from(descriptor.samples || descriptor || []);
    }

    async database() {
      if (!this.databasePromise) this.databasePromise = openAudioDatabase().catch(error => {
        this.log('audio-db-unavailable', { error: error?.message || String(error) });
        return null;
      });
      return this.databasePromise;
    }

    async persistMeasurements() {
      const database = await this.database();
      if (!database) return 0;
      let stored = 0;
      for (const record of this.measurements) {
        if (this.persistedIds.has(record.id)) continue;
        await transaction(database, STORE_NAME, 'readwrite', store => store.put({
          ...record,
          recording: record.recording instanceof Int16Array ? record.recording : new Int16Array(record.recording || []),
        }));
        this.persistedIds.add(record.id);
        stored += 1;
        if (stored % 3 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      await transaction(database, META_STORE_NAME, 'readwrite', store => store.put({
        key: 'latest-manifest',
        updatedAt: new Date().toISOString(),
        measurements: this.measurements.map(record => this.measurementManifest(record)),
      }));
      this.log('measurements-persisted', { stored, total: this.measurements.length });
      return stored;
    }

    async loadMeasurement(id) {
      const inMemory = this.measurements.find(record => String(record.id) === String(id));
      if (inMemory) return inMemory;
      const database = await this.database();
      if (!database) return null;
      return transaction(database, STORE_NAME, 'readonly', (store, setResult) => {
        const request = store.get(id);
        request.onsuccess = () => setResult(request.result || null);
        request.onerror = () => setResult(null);
      });
    }

    async loadAll(manifest = null) {
      const records = [];
      for (const item of manifest || []) {
        const record = await this.loadMeasurement(item.id || item.storageKey);
        if (record) records.push(record);
      }
      return records;
    }

    async clearPersisted() {
      const database = await this.database();
      if (!database) return false;
      await transaction(database, STORE_NAME, 'readwrite', store => store.clear?.());
      await transaction(database, META_STORE_NAME, 'readwrite', store => store.clear?.());
      this.persistedIds.clear();
      return true;
    }

    resolvePose(record, metricPath) {
      const onsetAbsoluteFrame = Number(record.recordingStartFrame) + Number(record.onsetSample ?? record.expectedOnsetSample);
      const contextTime = onsetAbsoluteFrame / Math.max(1, record.sampleRate || this.sampleRate);
      const clockMap = record.clockMap;
      const performanceTime = clockMap
        ? clockMap.slope * contextTime + clockMap.intercept
        : record.scheduledPerformanceTime;
      const pose = S.interpolatePose(metricPath, performanceTime) || record.receiverPoseAtSchedule;
      if (pose?.p) {
        record.receiverPose = pose;
        const receiverOffset = record.metadata?.receiverLocalOffset;
        const sourceOffset = record.metadata?.sourceLocalOffset;
        const receiverWorldOffset = receiverOffset ? rotateVectorByQuaternion(receiverOffset, pose.q) : null;
        record.receiverPosition = receiverWorldOffset
          ? pose.p.map((value, index) => value + receiverWorldOffset[index])
          : [...pose.p];
        if (record.sourceMode === 'monostatic' && sourceOffset) {
          const sourceWorldOffset = rotateVectorByQuaternion(sourceOffset, pose.q);
          record.sourcePosition = pose.p.map((value, index) => value + sourceWorldOffset[index]);
        }
        record.posePerformanceTime = performanceTime;
      }
      return pose;
    }

    async stop(options = {}) {
      this.freezeScheduling();
      if (options.flush !== false) await this.flushPending({ maximumWaitMs: options.maximumWaitMs });
      if (options.persist !== false) await this.persistMeasurements();
      clearInterval(this.clockTimer);
      this.clockTimer = null;
      try { this.captureNode?.port?.postMessage?.({ command: 'flush' }); } catch {}
      try { this.sourceNode?.disconnect?.(); } catch {}
      try { this.captureNode?.disconnect?.(); } catch {}
      try { this.keepAliveGain?.disconnect?.(); } catch {}
      try { this.outputGain?.disconnect?.(); } catch {}
      try { this.track?.stop?.(); } catch {}
      for (const track of this.stream?.getTracks?.() || []) {
        try { track.stop(); } catch {}
      }
      try { await this.context?.close?.(); } catch {}
      this.context = null;
      this.stream = null;
      this.track = null;
      this.sourceNode = null;
      this.captureNode = null;
      this.keepAliveGain = null;
      this.outputGain = null;
      this.status = 'stopped';
      this.emit('status', this.status);
      this.log('audio-stopped');
      return this.summary();
    }

    summary() {
      return {
        status: this.status,
        sampleRate: this.sampleRate,
        settings: { ...this.audioSettings },
        capabilities: { ...this.audioCapabilities },
        contextCreation: { ...this.contextCreation, actualSampleRate: this.sampleRate },
        meter: { ...this.meter },
        measurements: this.measurements.length,
        pending: this.pending.size,
        persisted: this.persistedIds.size,
        baseLatencySeconds: this.context?.baseLatency ?? null,
        outputLatencySeconds: this.context?.outputLatency ?? null,
        clockMap: this.clockMap ? { ...this.clockMap } : null,
        schedulingFrozen: this.schedulingFrozen,
      };
    }
  }

  return {
    DB_NAME,
    STORE_NAME,
    META_STORE_NAME,
    openAudioDatabase,
    compactPose,
    quaternionFromMatrix,
    rotateVectorByQuaternion,
    AcousticCaptureController,
  };
});
