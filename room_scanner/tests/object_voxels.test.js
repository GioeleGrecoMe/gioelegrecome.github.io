'use strict';

const assert = require('assert');
const C = require('../roomscan_core.js');

const size = 0.1;
const map = new Map();
for (let x = 0; x < 3; x += 1) {
  for (let y = 0; y < 2; y += 1) {
    for (let z = 0; z < 2; z += 1) {
      const point = [1 + x * size, 0.3 + y * size, 1.2 + z * size];
      C.mergeVoxel(map, point, { source: 'XR', viewId: 'A', frameId: 1, roomId: 'R1', color: [200, 120, 80] }, size);
      C.mergeVoxel(map, point, { source: 'Deep', viewId: 'B', frameId: 2, roomId: 'R1', color: [210, 130, 90] }, size);
    }
  }
}
const components = C.connectedVoxelComponents(map, size, 8);
assert.equal(components.length, 1);
assert.equal(components[0].length, 12);
const object = C.objectFromVoxels(components[0], 'O1', size);
assert.equal(object.kind, 'scan');
assert.ok(object.confidence > 0.75);
assert.ok(object.obb.extent[0] >= 0.29);
assert.ok(object.obb.extent[1] >= 0.19);
assert.ok(object.mesh.vertices.length > 0);
assert.ok(object.mesh.indices.length > 0);
assert.equal(object.mesh.colors.length, object.mesh.vertices.length);
assert.equal(object.shape.representation, 'colored-voxel-surface');
assert.equal(object.rgbSummary.pointCount, object.points.length);
assert.ok(object.points.every(item => Array.isArray(item.color) && item.color.length === 3));

// Repeated evidence from only one spatial view is not enough to create an
// object component, even if the same voxel was observed many times.
const oneView = new Map();
for (let x = 0; x < 3; x += 1) {
  for (let y = 0; y < 3; y += 1) {
    const point = [x * size, y * size, 0.5];
    for (let repeat = 0; repeat < 6; repeat += 1) {
      C.mergeVoxel(oneView, point, { source: 'Deep', viewId: 'ONLY', frameId: repeat, roomId: 'R1' }, size);
    }
  }
}
assert.equal(C.connectedVoxelComponents(oneView, size, 8).length, 0);


// Two genuinely different views can disagree by one voxel after metric depth
// fitting. Neighborhood persistence must keep this compact object instead of
// requiring both observations to quantize to exactly the same cell.
const nearbyViews = new Map();
for (let x = 0; x < 3; x += 1) {
  for (let y = 0; y < 2; y += 1) {
    for (let z = 0; z < 2; z += 1) {
      const point = [2 + x * size, 0.2 + y * size, 0.8 + z * size];
      C.mergeVoxel(nearbyViews, point, { source: 'Deep', viewId: x % 2 ? 'LEFT' : 'RIGHT', roomId: 'R2' }, size);
    }
  }
}
const nearbyComponents = C.connectedVoxelComponents(nearbyViews, size, 8);
assert.equal(nearbyComponents.length, 1);
assert.equal(nearbyComponents[0].length, 12);

// Adjacent evidence from different rooms alone must not merge through a portal
// into a single furniture component.
const separateRooms = new Map();
for (let x = 0; x < 2; x += 1) {
  for (let y = 0; y < 2; y += 1) {
    const left = [4 + x * size, 0.2 + y * size, 1.0];
    const right = [4.2 + x * size, 0.2 + y * size, 1.0];
    C.mergeVoxel(separateRooms, left, { source: 'Deep', viewId: x ? 'A2' : 'A1', roomId: 'RA' }, size);
    C.mergeVoxel(separateRooms, right, { source: 'Deep', viewId: x ? 'B2' : 'B1', roomId: 'RB' }, size);
  }
}
assert.equal(C.connectedVoxelComponents(separateRooms, size, 6).length, 0);

console.log('PASS object_voxels');
