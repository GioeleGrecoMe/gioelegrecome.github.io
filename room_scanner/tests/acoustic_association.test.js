'use strict';

const assert = require('assert');
const C = require('../roomscan_core.js');
const A = require('../roomscan_acoustics.js');

const room = {
  id: 'R1', name: 'Vano 1', height: 2.7,
  footprint: [[0, 0], [5, 0], [5, 4], [0, 4]],
};
room.model = C.buildRoomModel(room.footprint, 0, room.height);
room.fittedModel = room.model;
const surfaces = C.buildAcousticSurfaceModel([room], [], [], {}, []);
const zones = A.buildAcousticZones([room], [], surfaces, {
  wallZoneWidth: 1,
  wallZoneHeight: 0.9,
  maximumWallColumns: 8,
  maximumWallRows: 3,
});

const source = [0.7, 1.30, 2.2];
const receiver = [0.78, 1.35, 2.2];
const wall3 = zones.primary.filter(zone => zone.surfaceType === 'wall' && zone.surfaceIndex === 3);
const path = A.planePathCandidate(source, receiver, wall3[0]);
assert.ok(path);
const expectedZone = wall3
  .map(zone => ({ zone, containment: A.zoneContainment(path.reflectionPoint, zone) }))
  .sort((a, b) => b.containment.score - a.containment.score)[0].zone;
const association = A.associateEchoPeak({ delaySeconds: path.relativeDelaySeconds, snrDb: 24, bandEnergy: [] }, source, receiver, zones.primary, {
  roomId: room.id,
  sampleRate: 48000,
  unassignedPrior: 0.001,
});
assert.ok(association.candidates.length > 0);
assert.equal(association.candidates[0].zoneId, expectedZone.id);
assert.ok(association.candidates[0].posterior > association.unassignedPosterior);
assert.ok(Math.abs(association.candidates[0].residualSeconds) < 1e-9);

const impossible = A.associateEchoPeak({ delaySeconds: 0.083, snrDb: 8, bandEnergy: [] }, source, receiver, zones.primary, {
  roomId: room.id,
  sampleRate: 48000,
  unassignedPrior: 0.25,
  timingSigmaSeconds: 0.00015,
});
assert.ok(impossible.unassignedPosterior > (impossible.candidates[0]?.posterior || 0));

const evidenceZone = zones.primary.find(zone => zone.id === expectedZone.id);
const makeMeasurement = (id, ratio) => ({
  ok: true,
  id,
  roomId: room.id,
  quality: { score: 0.92 },
  analysis: { decay: C.ACOUSTIC_BANDS.map(() => null) },
  associations: [{
    peak: {
      snrDb: 24,
      bandEnergy: C.ACOUSTIC_BANDS.map(() => ({ ratio })),
    },
    candidates: [{
      zoneId: evidenceZone.id,
      posterior: 0.92,
      spreadingCorrection: 1,
      residualSeconds: 0,
      timingSigma: 0.001,
      geometryConfidence: 0.9,
      reflectionPoint: path.reflectionPoint,
    }],
  }],
});
const inference = A.inferZoneAbsorption([
  makeMeasurement('M1', 0.40),
  makeMeasurement('M2', 0.42),
  makeMeasurement('M3', 0.38),
], zones, [room], { bands: C.ACOUSTIC_BANDS, minimumPosterior: 0.12 });
const inferredZone = inference.zones.find(zone => zone.zoneId === evidenceZone.id);
assert.ok(inferredZone);
assert.ok(inferredZone.alpha.every(value => value > 0.35 && value < 0.8));
assert.ok(inferredZone.confidence.some(value => value > 0.2));

A.applyInferenceToAcousticSurfaces(surfaces, inference);
const inferredSurface = surfaces.find(surface => surface.id === evidenceZone.ownerSurfaceId);
assert.equal(inferredSurface.material.mode, 'inferred');
assert.equal(inferredSurface.material.source, 'rir-zone-inference');

const floor = surfaces.find(surface => surface.role === 'floor');
C.applyMaterialToSurface(floor, 'carpet', { mode: 'manual', alpha: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7] });
const manualBefore = [...floor.material.alpha];
A.applyInferenceToAcousticSurfaces(surfaces, inference);
assert.deepEqual(floor.material.alpha, manualBefore);
assert.equal(floor.material.mode, 'manual');

console.log('PASS acoustic_association');
