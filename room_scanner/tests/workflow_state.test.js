'use strict';

const assert = require('assert');
const { createHarness } = require('./app_harness.js');

const harness = createHarness();
const { C, api, state, elements, alerts } = harness;

function addFootprint(points) {
  elements.get('smartSnap').checked = false;
  for (const point of points) {
    state.aimSamples = [];
    state.aimPoint = [point[0], 0, point[1]];
    api.addCorner();
  }
}

function addCoverageFrames(roomId, startId) {
  for (let index = 0; index < 3; index += 1) {
    state.frames.push({ id: startId + index, roomId, viewCluster: `view-${roomId}-${index}` });
  }
}

api.beginRoom();
assert.equal(state.phase, 'corners');
assert.equal(state.activeRoomId, 'R1');
addFootprint([[0, 0], [4, 0], [4, 3], [0, 3]]);
api.closeRoom();
assert.equal(state.phase, 'height');
assert.ok(Math.abs(state.rooms[0].model.area - 12) < 1e-9);
api.confirmHeight(false);
assert.equal(state.phase, 'coverage');
addCoverageFrames('R1', 1);
api.completeRoom();
assert.equal(state.phase, 'room-ready');
assert.equal(state.acousticSurfaces.length, 6, 'room shell must expose floor, ceiling and four walls');

state.currentCamera = { position: [2, 1.45, 1.5], yaw: 0, pitch: 0 };
api.beginTransition();
state.transition.path = [[2, 1.5], [3.8, 1.5], [4.35, 1.5]];
state.transition.crossing = C.pathBoundaryCrossing(state.transition.path, state.rooms[0].model);
assert.equal(state.transition.crossing.kind, 'exit');
state.currentCamera = { position: [4.35, 1.45, 1.5], yaw: 0, pitch: 0 };
api.finishTransition();
assert.equal(state.phase, 'corners');
assert.equal(state.activeRoomId, 'R2');
assert.equal(state.portals.length, 1);

addFootprint([[4, 0], [7, 0], [7, 3], [4, 3]]);
api.closeRoom();
assert.equal(state.phase, 'height');
assert.equal(state.pendingPortalId, null);
assert.equal(state.portals[0].targetRoomId, 'R2');
assert.equal(state.portals[0].sides.length, 2);
assert.deepEqual(new Set(state.portals[0].sides.map(side => side.roomId)), new Set(['R1', 'R2']));

api.confirmHeight(false);
addCoverageFrames('R2', 4);
api.completeRoom();
assert.equal(state.phase, 'room-ready');
assert.equal(state.rooms.filter(room => room.status === 'complete').length, 2);
assert.equal(state.acousticSurfaces.filter(surface => surface.ownerType === 'room').length, 12);
assert.equal(alerts.length, 0, alerts.join('\n'));

console.log('PASS workflow_state');
