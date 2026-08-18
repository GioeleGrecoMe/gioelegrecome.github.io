'use strict';

const assert = require('assert');
const C = require('../roomscan_core.js');
const { createHarness, addRoomFootprint } = require('./app_harness.js');

const size = 0.08;
const voxels = new Map();
for (let x = 0; x < 3; x += 1) {
  for (let y = 0; y < 3; y += 1) {
    for (let z = 0; z < 2; z += 1) {
      const point = [0.6 + x * size, 0.25 + y * size, 0.8 + z * size];
      const colorA = [80 + 30 * x, 60 + 25 * y, 45 + 40 * z];
      const colorB = colorA.map(value => Math.min(255, value + 10));
      C.mergeVoxel(voxels, point, { source: 'XR', viewId: 'LEFT', frameId: 1, roomId: 'R1', color: colorA }, size);
      C.mergeVoxel(voxels, point, { source: 'Deep', viewId: 'RIGHT', frameId: 2, roomId: 'R1', color: colorB }, size);
    }
  }
}
const component = C.connectedVoxelComponents(voxels, size, 8)[0];
const object = C.objectFromVoxels(component, 'O1', size);
assert.equal(object.shape.representation, 'colored-voxel-surface');
assert.equal(object.shape.voxelSize, size);
assert.equal(object.rgbSummary.pointCount, object.points.length);
assert.ok(object.shape.occupiedVolume > 0);
assert.ok(object.shape.fillRatio > 0 && object.shape.fillRatio <= 1);
assert.ok(object.points.every(item => item.color.length === 3));
assert.equal(object.mesh.colors.length, object.mesh.vertices.length, 'each voxel-surface vertex needs RGB');
assert.equal(object.mesh.triangleFaceKeys.length, object.mesh.indices.length / 3, 'every mesh triangle needs an acoustic face label');
assert.deepEqual([...new Set(object.mesh.triangleFaceKeys)].sort(), ['back', 'bottom', 'front', 'left', 'right', 'top']);
assert.equal(object.mesh.acousticPartition, 'obb-six-face-labels');
assert.ok(object.mesh.colors.some(color => color[0] !== color[1] || color[1] !== color[2]));

const harness = createHarness();
addRoomFootprint(harness, [[0, 0], [3, 0], [3, 2], [0, 2]], 2.6);
object.roomId = 'R1';
harness.state.objects = [object];
harness.api.refreshAcousticSurfaces();
const raw = harness.api.buildRawSnapshot();
assert.equal(raw.objects[0].points.length, object.points.length);
assert.deepEqual(raw.objects[0].points[0].color, object.points[0].color);
assert.equal(raw.objects[0].mesh.colors.length, raw.objects[0].mesh.vertices.length);
assert.equal(raw.acousticSurfaces.filter(surface => surface.ownerId === 'O1').length, 6);

const manual = C.createManualObject('M1', 'Proxy manuale', [0.2, 0.2], [1.1, 0.9], 0, 0.75);
assert.ok(manual.points.length > 8, 'manual occupancy needs a visible RGB shell');
assert.ok(manual.points.every(item => item.synthetic === true));
assert.equal(manual.shape.representation, 'manual-rgb-cuboid');
assert.equal(manual.rgbSummary.pointCount, manual.points.length);
assert.equal(manual.mesh.triangleFaceKeys.length, manual.mesh.indices.length / 3);
assert.deepEqual([...new Set(manual.mesh.triangleFaceKeys)].sort(), ['back', 'bottom', 'front', 'left', 'right', 'top']);

const originalPoint = [...object.points[0].point];
const originalVertex = [...object.mesh.vertices[0]];
harness.elements.get('objectSelect').value = object.id;
harness.elements.get('objectName').value = 'Oggetto corretto';
harness.elements.get('objectLength').value = String(object.obb.extent[0] * 1.4);
harness.elements.get('objectDepth').value = String(object.obb.extent[2] * 0.8);
harness.elements.get('objectHeight').value = String(object.obb.extent[1] * 1.2);
harness.elements.get('objectYaw').value = '27';
harness.api.applyObjectEdits();
assert.equal(object.edited, true);
assert.equal(object.shape.representation, 'edited-colored-voxel-surface');
assert.equal(object.name, 'Oggetto corretto');
assert.notDeepEqual(object.points[0].point, originalPoint, 'RGB points must follow the edited OBB');
assert.notDeepEqual(object.mesh.vertices[0], originalVertex, 'colored voxel mesh must follow the edited OBB');
assert.equal(object.mesh.colors.length, object.mesh.vertices.length, 'RGB must survive object edits');
assert.equal(object.mesh.triangleFaceKeys.length, object.mesh.indices.length / 3, 'acoustic triangle mapping must survive object edits');

console.log('PASS rgb_object_points');
