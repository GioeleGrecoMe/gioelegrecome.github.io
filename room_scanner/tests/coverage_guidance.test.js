'use strict';

const assert = require('assert');
const { createHarness, addRoomFootprint } = require('./app_harness.js');

const harness = createHarness();
const { C, api, state } = harness;
const room = addRoomFootprint(harness, [[0, 0], [4, 0], [4, 3], [0, 3]]);
assert.ok(room.photoTargets.length > 0);

const near = 0.1;
const far = 20;
state.currentProjection = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, -(far + near) / (far - near), -1,
  0, 0, -2 * far * near / (far - near), 0,
];
state.currentPoseMatrix = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  2, 1.35, 2, 1,
];
state.currentWorldToView = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  -2, -1.35, -2, 1,
];
state.currentCamera = { position: [2, 1.35, 2], yaw: -Math.PI / 2, pitch: 0 };
state.motion.linear = 0;
state.motion.angular = 0;

let guide = api.coverageGuidance(room);
assert.ok(guide.target, 'a real wall-attached tile must be selected');
assert.equal(guide.targetStatus, 'red');
assert.ok(['center', 'left', 'right', 'up', 'down'].includes(guide.turn));
assert.ok(guide.instruction.toLowerCase().includes('casella') || guide.instruction.toLowerCase().includes('fotografa'));

const lower = room.photoTargets.find(target => target.wallIndex === 0 && target.column === 1 && target.role === 'objects');
C.registerPhotoTargetObservation(lower, { frameId: 1, viewCluster: C.viewClusterId(state.currentPoseMatrix, api.CONFIG.viewClusterSize), score: 0.9 });
assert.equal(C.photoTargetStatus(lower), 'yellow');
// Make every other tile green so guidance must select the yellow lower tile.
for (const target of room.photoTargets) {
  if (target === lower) continue;
  C.registerPhotoTargetObservation(target, { frameId: 2, viewCluster: 'other', score: 0.8 });
  if (target.requiredViews > 1) C.registerPhotoTargetObservation(target, { frameId: 3, viewCluster: 'third', score: 0.8 });
}
guide = api.coverageGuidance(room);
assert.equal(guide.target.id, lower.id);
assert.equal(guide.targetStatus, 'yellow');
assert.equal(guide.needsNewView, true);
assert.ok(guide.instruction.includes('mezzo metro'));

C.registerPhotoTargetObservation(lower, { frameId: 4, viewCluster: 'second-position', score: 0.9 });
guide = api.coverageGuidance(room);
assert.equal(guide.remaining, 0);
assert.equal(guide.target, null);
assert.equal(guide.green, guide.total);

// Completion is based on a small reliable metric minimum, not an impossible
// all-green deadlock. Re-open one tile as red and keep three frames/two poses.
lower.observations = [];
state.frames = [
  { id: 10, roomId: room.id, viewCluster: 'A' },
  { id: 11, roomId: room.id, viewCluster: 'B' },
  { id: 12, roomId: room.id, viewCluster: 'B' },
];
const readiness = api.roomCompletionReadiness(room);
assert.equal(readiness.ready, true);
assert.ok(readiness.unresolved >= 1);
assert.equal(api.completeRoom(), true);
assert.equal(state.phase, 'room-ready');
assert.ok(room.captureSummary.completedWithUnresolvedTargets >= 1);

console.log('PASS coverage_guidance');
