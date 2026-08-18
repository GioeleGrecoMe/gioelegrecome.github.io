'use strict';

const assert = require('assert');
const C = require('../roomscan_core.js');
const { createHarness, addRoomFootprint } = require('./app_harness.js');

function nearly(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${expected}, received ${actual}`);
}

const room = {
  id: 'R1', name: 'Vano 1', height: 2.7,
  footprint: [[0, 0], [4, 0], [4, 3], [0, 3]],
};
room.model = C.buildRoomModel(room.footprint, 0, room.height);
const object = C.createManualObject('O1', 'Divano', [0.5, 0.6], [2.1, 1.5], 0, 0.9);
object.roomId = 'R1';
object.points = [
  { point: [0.7, 0.4, 0.8], color: [120, 65, 35] },
  { point: [1.2, 0.5, 0.9], color: [135, 75, 45] },
  { point: [1.7, 0.6, 1.1], color: [145, 85, 55] },
];
const portal = {
  id: 'P1',
  top: 2,
  sides: [{ portalId: 'P1', roomId: 'R1', wallIndex: 0, s0: 1, s1: 2, top: 2 }],
};
const evidence = {
  'R1:floor': C.visualFeaturesFromColors([[150, 95, 45], [160, 100, 50], [145, 88, 42]]),
  O1: C.visualFeaturesFromColors(object.points),
};
let surfaces = C.buildAcousticSurfaceModel([room], [object], [portal], evidence, []);
assert.equal(surfaces.length, 12, 'one room shell plus six object proxy faces');
assert.deepEqual(C.ACOUSTIC_BANDS, [125, 250, 500, 1000, 2000, 4000, 8000]);
assert.ok(surfaces.every(surface => surface.material.alpha.length === 7));
assert.ok(surfaces.every(surface => surface.material.mode === 'auto'));
assert.ok(surfaces.every(surface => surface.material.confidence <= 0.28));

const wall = surfaces.find(surface => surface.id === 'R1:wall:0');
nearly(wall.grossArea, 4 * 2.7);
nearly(wall.area, 4 * 2.7 - 2);
assert.equal(wall.openings.length, 1);

const bottom = surfaces.find(surface => surface.id === 'O1:face:bottom');
const top = surfaces.find(surface => surface.id === 'O1:face:top');
const front = surfaces.find(surface => surface.id === 'O1:face:front');
nearly(bottom.area, object.obb.extent[0] * object.obb.extent[2]);
nearly(top.area, bottom.area);
nearly(front.area, object.obb.extent[0] * object.obb.extent[1]);
assert.deepEqual(bottom.normal.map(value => Math.round(value)), [0, -1, 0]);
assert.deepEqual(top.normal.map(value => Math.round(value)), [0, 1, 0]);
const objectSurfaces = surfaces.filter(surface => surface.ownerId === 'O1');
assert.ok(objectSurfaces.every(surface => surface.geometryRef?.type === 'object-mesh-triangle-label'));
assert.ok(objectSurfaces.every(surface => surface.geometryRef?.triangleFaceKey === surface.face));
assert.equal(objectSurfaces.reduce((sum, surface) => sum + surface.meshTriangleCount, 0), object.mesh.indices.length / 3, 'all RGB mesh triangles must inherit one editable acoustic face');

const floor = surfaces.find(surface => surface.id === 'R1:floor');
C.applyMaterialToSurface(floor, 'carpet', {
  mode: 'manual',
  alpha: [0.12, 0.20, 0.35, 0.48, 0.55, 0.62, 0.68],
  scattering: 0.31,
});
surfaces = C.buildAcousticSurfaceModel([room], [object], [portal], evidence, surfaces);
const rebuiltFloor = surfaces.find(surface => surface.id === 'R1:floor');
assert.equal(rebuiltFloor.material.mode, 'manual');
assert.equal(rebuiltFloor.material.source, 'user');
assert.deepEqual(rebuiltFloor.material.alpha, [0.12, 0.20, 0.35, 0.48, 0.55, 0.62, 0.68]);

const summary = C.acousticSummary([room], surfaces);
nearly(summary.volume, 12 * 2.7);
assert.equal(summary.source, 'manual+visual-prior');
assert.equal(summary.rt60Sabine.length, 7);

const harness = createHarness();
const appRoom = addRoomFootprint(harness, room.footprint, 2.7);
harness.state.objects = [object];
harness.api.refreshAcousticSurfaces();
const payload = harness.api.acousticExportPayload();
assert.equal(payload.schema, 'room-scanner-v20-1-visual-acoustic-twin');
assert.equal(payload.surfaces.length, 12);
assert.ok(payload.coefficientMeaning.inferred.includes('effective in-situ absorption'));
assert.equal(payload.metricFrame.includes('WebXR local-floor'), true);
assert.equal(payload.surfaces.find(surface => surface.id === 'O1:face:front').geometryRef.triangleFaceKey, 'front');
assert.equal(appRoom.id, 'R1');

const appWall = harness.state.acousticSurfaces.find(surface => surface.id === 'R1:wall:0');
harness.state.acoustic.selectedId = appWall.id;
harness.elements.get('acousticScope').value = 'surface';
assert.deepEqual(harness.api.acousticEditTargets(appWall).map(surface => surface.id), [appWall.id]);
harness.elements.get('acousticScope').value = 'owner';
assert.equal(harness.api.acousticEditTargets(appWall).filter(surface => surface.role === 'wall').length, 4, 'room wall group scope');
const appObjectFace = harness.state.acousticSurfaces.find(surface => surface.id === 'O1:face:front');
harness.state.acoustic.selectedId = appObjectFace.id;
assert.equal(harness.api.acousticEditTargets(appObjectFace).length, 6, 'object group scope must expose all six proxy faces');

// Zero is a valid physical/user value and must not be replaced by a fallback.
harness.elements.get('acousticSurfaceSelect').value = appWall.id;
harness.state.acoustic.selectedId = appWall.id;
harness.elements.get('acousticScope').value = 'owner';
harness.elements.get('acousticMaterial').value = 'painted';
for (const band of C.ACOUSTIC_BANDS) harness.elements.get(`alpha${band}`).value = '0';
harness.elements.get('acousticScattering').value = '0';
harness.api.applyAcousticEdits();
const editedWalls = harness.state.acousticSurfaces.filter(surface => surface.roomId === 'R1' && surface.role === 'wall');
assert.equal(editedWalls.length, 4);
assert.ok(editedWalls.every(surface => surface.material.mode === 'manual'));
assert.ok(editedWalls.every(surface => surface.material.source === 'user'));
assert.ok(editedWalls.every(surface => surface.material.scattering === 0));
assert.ok(editedWalls.every(surface => surface.material.alpha.every(value => value === 0)));

// Applying Auto to the same intelligent group rebuilds role/visual priors
// without losing the surface topology.
harness.elements.get('acousticMaterial').value = 'auto';
harness.api.applyAcousticEdits();
const automaticWalls = harness.state.acousticSurfaces.filter(surface => surface.roomId === 'R1' && surface.role === 'wall');
assert.ok(automaticWalls.every(surface => surface.material.mode === 'auto'));
assert.ok(automaticWalls.every(surface => surface.material.source.includes('prior-v10')));
assert.equal(automaticWalls.length, 4);

console.log('PASS acoustic_surfaces');
