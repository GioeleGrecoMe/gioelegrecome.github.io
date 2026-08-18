'use strict';

const assert = require('assert');
const { createHarness, addRoomFootprint } = require('./app_harness.js');

const harness = createHarness();
const room = addRoomFootprint(harness, [[0, 0], [0.015, 0], [0.015, 0.012], [3, 0.012], [3, 2.5], [0, 2.5]]);
assert.ok(room.corners[0].point);
harness.state.audio.manifests = [{
  id: 'rir-1', roomId: room.id, sampleRate: 48000,
  clockMap: { slope: 1000, intercept: 125, residualMadMs: 0.4, residualP95Ms: 0.8, sampleCount: 12, r2: 0.999 },
  sweepConfig: { f0: 180, f1: 15000, durationSeconds: 0.28, amplitude: 0.5 },
}];
const raw = harness.api.buildRawSnapshot({ checkpoint: true, separateFrameImages: true });
assert.equal(raw.schema, 'room-scanner-v20-1-raw');
assert.ok(raw.rooms[0].corners[0].point);
assert.equal(Array.isArray(raw.rooms[0].corners[0]), false);
assert.doesNotThrow(() => structuredClone(raw));

harness.state.rooms = [];
harness.api.applyRawSnapshot(structuredClone(raw));
assert.equal(harness.state.rooms.length, 1);
assert.deepEqual(harness.state.rooms[0].corners[0].point, [0, 0]);
assert.ok(harness.state.rooms[0].footprint.some((point, index, points) => index && CumulativeDistance(points[index - 1], point) < 0.02));

function CumulativeDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

console.log('PASS checkpoint_clone');
