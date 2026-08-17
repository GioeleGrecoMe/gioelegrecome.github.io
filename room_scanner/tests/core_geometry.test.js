'use strict';

const assert = require('assert');
const C = require('../roomscan_core.js');

function nearly(actual, expected, tolerance = 1e-6, message = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} expected ${expected}, received ${actual}`);
}

// A room polygon is accepted only when it has a usable metric area and does
// not self-intersect. The model remains in the same global WebXR coordinates.
const footprint = [[0, 0], [4, 0], [4, 3], [0, 3]];
const validation = C.validateFootprint(footprint);
assert.equal(validation.ok, true);
const roomModel = C.buildRoomModel(footprint, 0, 2.7);
nearly(roomModel.area, 12);
assert.equal(roomModel.walls.length, 4);
nearly(roomModel.walls[1].length, 3);
nearly(roomModel.ceilingY, 2.7);
assert.deepEqual(roomModel.centroid.map(v => Number(v.toFixed(4))), [2, 1.5]);

const bowTie = C.validateFootprint([[0, 0], [2, 2], [0, 2], [2, 0]]);
assert.equal(bowTie.ok, false);

// Smart snapping keeps an almost-orthogonal next wall orthogonal, but leaves
// clearly irregular geometry untouched.
const snapped = C.snapFloorCorner([4.08, 2.91], [[0, 0], [4, 0]], { orthogonal: true });
assert.equal(snapped.snapped, true);
nearly(snapped.point[0], 4, 0.12);
assert.ok(snapped.point[1] > 2.7);
const unsnapped = C.snapFloorCorner([5.5, 2.0], [[0, 0], [4, 0]], { orthogonal: false });
assert.equal(unsnapped.snapped, false);

// The camera path exits the first room through its right wall. The portal is
// created there and then associated with the coincident wall of the next room,
// with no independent room registration step.
const roomA = { id: 'R1', model: roomModel };
const path = [[2, 1.5], [3.7, 1.5], [4.25, 1.5], [4.8, 1.5]];
const crossing = C.pathBoundaryCrossing(path, roomA.model);
assert.ok(crossing);
assert.equal(crossing.kind, 'exit');
assert.equal(crossing.wallIndex, 1);
nearly(crossing.point[0], 4, 1e-6);
const portal = C.createPortalFromCrossing(roomA, crossing, 0.95, 2.1);
portal.id = 'P1';
assert.ok(portal.width >= 0.90 && portal.width <= 1.0);
assert.equal(portal.sourceRoomId, 'R1');

const roomB = { id: 'R2', model: C.buildRoomModel([[4, 0], [7, 0], [7, 3], [4, 3]], 0, 2.7) };
const link = C.linkPortalToRoom(portal, [roomA, roomB], roomB);
assert.equal(link.ok, true);
assert.equal(portal.targetRoomId, 'R2');
assert.equal(portal.sides.length, 2);
assert.equal(portal.sides.find(side => side.roomId === 'R2').wallIndex, 3);

// A ray from the center of room A toward +X reaches the expected wall. This is
// the same deterministic primitive used to scale Deep and detect foreground.
const rayHit = C.rayRoomHit({ origin: [2, 1.4, 1.5], direction: [1, 0, 0] }, roomA.model);
assert.ok(rayHit);
nearly(rayHit.distance, 2);
assert.equal(rayHit.kind, 'wall');
assert.equal(rayHit.wallIndex, 1);

// Manual objects are bounded cuboids and remain independently editable.
const manual = C.createManualObject('O1', 'Tavolo', [0.5, 0.5], [1.7, 1.4], 0, 0.78);
assert.equal(manual.kind, 'manual');
assert.deepEqual(manual.obb.extent.map(v => Number(v.toFixed(2))), [1.2, 0.78, 0.9]);
assert.equal(manual.mesh.vertices.length, 8);
assert.equal(manual.mesh.indices.length, 36);

// Portal cutouts remove the opening area from the wall shell. Triangle area is
// measured directly, avoiding assumptions about the number of quads emitted.
function triangleArea3(a, b, c) {
  const ab = C.sub3(b, a);
  const ac = C.sub3(c, a);
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  return C.len3(cross) / 2;
}
function groupArea(mesh, group) {
  let area = 0;
  for (let triangle = 0; triangle < mesh.groups.length; triangle += 1) {
    if (mesh.groups[triangle] !== group) continue;
    const base = triangle * 3;
    area += triangleArea3(
      mesh.vertices[mesh.indices[base]],
      mesh.vertices[mesh.indices[base + 1]],
      mesh.vertices[mesh.indices[base + 2]],
    );
  }
  return area;
}
const shellWithoutPortal = C.roomShellMesh(roomA, []);
const shellWithPortal = C.roomShellMesh(roomA, [portal]);
const wallGroup = 'room:R1:wall:1';
nearly(groupArea(shellWithoutPortal, wallGroup), 3 * 2.7, 1e-6);
nearly(groupArea(shellWithPortal, wallGroup), 3 * 2.7 - portal.width * portal.top, 1e-5);

console.log('PASS core_geometry');
