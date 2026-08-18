'use strict';

const assert = require('assert');
const S = require('../roomscan_signal.js');
const AudioCapture = require('../roomscan_audio.js');

const clockSamples = [];
for (let index = 0; index < 20; index += 1) {
  clockSamples.push({
    contextTime: index * 0.25,
    performanceTime: 1000 + index * 250 + (index % 3 - 1) * 0.08,
  });
}
const fit = S.fitClockMap(clockSamples);
assert.ok(fit);
assert.ok(typeof fit.performanceTimeFromContext === 'function');
assert.doesNotThrow(() => structuredClone(fit.serializable));
assert.equal(Object.values(fit.serializable).some(value => typeof value === 'function'), false);

const controller = new AudioCapture.AcousticCaptureController();
controller.context = {
  currentTime: 2.5,
  getOutputTimestamp: () => ({ contextTime: 2.49, performanceTime: 3490 }),
};
for (let index = 0; index < 12; index += 1) {
  controller.context.currentTime = 2.5 + index * 0.1;
  controller.context.getOutputTimestamp = () => ({
    contextTime: 2.49 + index * 0.1,
    performanceTime: 3490 + index * 100,
  });
  controller.sampleClock();
}
assert.ok(controller.clockMap);
assert.equal(Object.values(controller.clockMap).some(value => typeof value === 'function'), false);
assert.doesNotThrow(() => structuredClone(controller.summary()));

const descriptor = S.generateESS(24000, 150, 10000, 0.12, 0.4, 0.005);
const restored = controller.regenerateSweep({
  sampleRate: 24000,
  sweepConfig: {
    f0: 150,
    f1: 10000,
    durationSeconds: 0.12,
    amplitude: 0.4,
    fadeSeconds: 0.005,
  },
});
assert.ok(restored instanceof Float32Array);
assert.equal(restored.length, descriptor.samples.length);

const rotated = AudioCapture.rotateVectorByQuaternion([1, 0, 0], [0, Math.SQRT1_2, 0, Math.SQRT1_2]);
assert.ok(Math.abs(rotated[0]) < 1e-6);
assert.ok(Math.abs(Math.abs(rotated[2]) - 1) < 1e-6);

console.log('PASS audio_serialization');
