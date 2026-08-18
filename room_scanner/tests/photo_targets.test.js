'use strict';

const assert = require('assert');
const C = require('../roomscan_core.js');

const model = C.buildRoomModel([[0, 0], [4, 0], [4, 3], [0, 3]], 0, 2.7);
const targets = C.createWallPhotoTargets(model, {
  desiredWidth: 1.35,
  maxColumns: 4,
  objectRequiredViews: 2,
  surfaceRequiredViews: 1,
});
assert.equal(targets.length, 24, 'four walls should be divided into metric lower/upper tiles');
assert.equal(targets.filter(target => target.role === 'objects').length, 12);
assert.equal(targets.filter(target => target.role === 'surface').length, 12);
assert.ok(targets.every(target => target.corners.length === 4));

// Camera at the room centre, looking toward wall z=0 with a 90-degree FOV.
const near = 0.1;
const far = 20;
const projection = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, -(far + near) / (far - near), -1,
  0, 0, -2 * far * near / (far - near), 0,
];
const cameraPosition = [2, 1.35, 2];
const worldToView = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  -2, -1.35, -2, 1,
];
const lower = targets.find(target => target.wallIndex === 0 && target.column === 1 && target.role === 'objects');
const upper = targets.find(target => target.wallIndex === 0 && target.column === 1 && target.role === 'surface');
const evaluation = C.evaluatePhotoTarget(lower, projection, worldToView, cameraPosition, { minimumScore: 0.43 });
assert.equal(evaluation.visible, true);
assert.equal(evaluation.good, true);
assert.ok(evaluation.center.u > 0.45 && evaluation.center.u < 0.55);
assert.ok(evaluation.clippedArea > 0.05);

assert.equal(C.photoTargetStatus(lower), 'red');
C.registerPhotoTargetObservation(lower, { frameId: 1, viewCluster: 'A', score: 0.9 });
assert.equal(C.photoTargetStatus(lower), 'yellow', 'lower/object tile needs a second position');
assert.equal(C.registerPhotoTargetObservation(lower, { frameId: 2, viewCluster: 'A', score: 0.8 }), false, 'same position must not count twice');
C.registerPhotoTargetObservation(lower, { frameId: 3, viewCluster: 'B', score: 0.85 });
assert.equal(C.photoTargetStatus(lower), 'green');

assert.equal(C.photoTargetStatus(upper), 'red');
C.registerPhotoTargetObservation(upper, { frameId: 4, viewCluster: 'A', score: 0.8 });
assert.equal(C.photoTargetStatus(upper), 'green', 'upper/surface tile needs one usable view');

const stats = C.photoTargetStats(targets);
assert.equal(stats.green, 2);
assert.equal(stats.red, 22);
assert.equal(stats.yellow, 0);
assert.ok(stats.progress > 0 && stats.progress < 1);

console.log('PASS photo_targets');
