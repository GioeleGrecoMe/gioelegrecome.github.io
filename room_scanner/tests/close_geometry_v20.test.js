'use strict';

const assert = require('assert');
const C = require('../roomscan_core.js');
const { createHarness } = require('./app_harness.js');

// A 0.7 mm return edge is accepted. This is far below any meaningful WebXR
// measurement precision and proves there is no user-facing minimum wall size.
const tinyReturn = [[0, 0], [1, 0], [1, 1], [0.9993, 1], [0.9993, 0.5], [0, 0.5]];
assert.equal(C.validateFootprint(tinyReturn).ok, true);
assert.ok(C.buildRoomModel(tinyReturn, 0, 2.7).walls.some(wall => wall.length < 0.001));

// Only a practically duplicated point is rejected to avoid a zero normal.
const duplicate = [[0, 0], [1, 0], [1, 1], [0.999999, 1], [0, 0.5]];
assert.equal(C.validateFootprint(duplicate).ok, false);

const harness = createHarness();
const { api, state, elements, alerts } = harness;
elements.get('smartSnap').checked = false;
api.beginRoom();
for (const point of [[0, 0], [1, 0], [1, 1], [0.0008, 0.0008]]) {
  state.aimPoint = [point[0], 0, point[1]];
  state.aimSamples = [];
  api.addCorner();
}
assert.equal(state.phase, 'corners', 'returning near the first corner must not auto-close');
assert.equal(state.rooms[0].footprint.length, 4);
api.closeRoom();
assert.equal(state.phase, 'height', 'only the explicit close action closes the footprint');
assert.equal(alerts.length, 0, alerts.join('\n'));

console.log('PASS close_geometry_v20');
