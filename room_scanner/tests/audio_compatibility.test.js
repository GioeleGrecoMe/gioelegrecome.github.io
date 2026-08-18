'use strict';

const assert = require('assert');
const AudioCapture = require('../roomscan_audio.js');

(async () => {
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalAudioContext = globalThis.AudioContext;
  const originalWebkitAudioContext = globalThis.webkitAudioContext;
  const originalAudioWorkletNode = globalThis.AudioWorkletNode;

  let mediaRequestCount = 0;
  let strictConstraints = null;
  let fallbackConstraints = null;
  let requestedWorkletUrl = null;
  let explicitContextAttempts = 0;
  let nativeContextAttempts = 0;
  let stoppedTracks = 0;

  const track = {
    getSettings() {
      return {
        sampleRate: 44100,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
      };
    },
    getCapabilities() {
      return {
        sampleRate: { min: 44100, max: 44100 },
        channelCount: { min: 1, max: 1 },
        echoCancellation: [true, false],
      };
    },
    stop() {
      stoppedTracks += 1;
    },
  };
  const stream = {
    getAudioTracks() { return [track]; },
    getTracks() { return [track]; },
  };

  class FakeNode {
    constructor() {
      this.gain = { value: 1 };
    }
    connect(target) { return target; }
    disconnect() {}
  }

  class FakeAudioContext {
    constructor(options = {}) {
      if (Object.prototype.hasOwnProperty.call(options, 'sampleRate')) {
        explicitContextAttempts += 1;
        throw new Error('native route only');
      }
      nativeContextAttempts += 1;
      this.sampleRate = 44100;
      this.currentTime = 0.25;
      this.baseLatency = 0.012;
      this.outputLatency = 0.041;
      this.destination = new FakeNode();
      this.audioWorklet = {
        addModule: async url => { requestedWorkletUrl = url; },
      };
    }
    async resume() {}
    async close() {}
    createMediaStreamSource() { return new FakeNode(); }
    createGain() { return new FakeNode(); }
    createBuffer(channels, length, sampleRate) {
      assert.equal(channels, 1);
      assert.equal(sampleRate, 44100);
      return {
        length,
        copyToChannel(samples, channel) {
          assert.equal(channel, 0);
          assert.equal(samples.length, length);
        },
      };
    }
    getOutputTimestamp() {
      return { contextTime: this.currentTime, performanceTime: 1250 };
    }
  }

  class FakeAudioWorkletNode extends FakeNode {
    constructor(context, name, options) {
      super();
      assert.equal(context.sampleRate, 44100);
      assert.equal(name, 'roomscan-pcm-capture-v20-1');
      assert.equal(options.processorOptions.chunkFrames, 4096);
      this.port = {
        onmessage: null,
        postMessage() {},
      };
    }
  }

  try {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        mediaDevices: {
          async getUserMedia(constraints) {
            mediaRequestCount += 1;
            if (mediaRequestCount === 1) {
              strictConstraints = constraints;
              throw new Error('exact DSP constraints unsupported');
            }
            fallbackConstraints = constraints;
            return stream;
          },
        },
      },
    });
    globalThis.AudioContext = FakeAudioContext;
    delete globalThis.webkitAudioContext;
    globalThis.AudioWorkletNode = FakeAudioWorkletNode;

    const controller = new AudioCapture.AcousticCaptureController({
      sampleRate: 48000,
      workletUrl: './roomscan_audio_worklet_v20_1_0.js',
    });
    const summary = await controller.prepare();

    assert.equal(mediaRequestCount, 2);
    assert.equal(strictConstraints.audio.echoCancellation.exact, false);
    assert.equal(fallbackConstraints.audio.echoCancellation, false);
    assert.equal(explicitContextAttempts, 1);
    assert.equal(nativeContextAttempts, 1);
    assert.equal(requestedWorkletUrl, './roomscan_audio_worklet_v20_1_0.js');
    assert.equal(summary.sampleRate, 44100);
    assert.equal(summary.contextCreation.requestedSampleRate, 48000);
    assert.equal(summary.contextCreation.usedFallback, true);
    assert.match(summary.contextCreation.fallbackReason, /native route only/);
    assert.equal(summary.settings.echoCancellation, true);
    assert.deepEqual(summary.capabilities.sampleRate, { min: 44100, max: 44100 });
    assert.ok(controller.sweep instanceof Float32Array);
    assert.ok(controller.sweep.length > 1000);
    assert.ok(controller.sweepDescriptor.f1 <= 44100 * 0.44 + 1e-9);
    assert.doesNotThrow(() => structuredClone(summary));

    await controller.stop({ flush: false, persist: false });
    assert.ok(stoppedTracks >= 1);
  } finally {
    if (originalNavigatorDescriptor) Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    else delete globalThis.navigator;
    if (originalAudioContext === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = originalAudioContext;
    if (originalWebkitAudioContext === undefined) delete globalThis.webkitAudioContext;
    else globalThis.webkitAudioContext = originalWebkitAudioContext;
    if (originalAudioWorkletNode === undefined) delete globalThis.AudioWorkletNode;
    else globalThis.AudioWorkletNode = originalAudioWorkletNode;
  }

  console.log('PASS audio_compatibility');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
