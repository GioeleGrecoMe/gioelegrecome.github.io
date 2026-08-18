'use strict';

const assert = require('assert');
const { createHarness, addRoomFootprint, createMemoryIndexedDB } = require('./app_harness.js');

(async () => {
  const indexedDB = createMemoryIndexedDB();
  const harness = createHarness({ indexedDB });
  const { C, api, state, elements } = harness;
  await new Promise(resolve => setTimeout(resolve, 12));
  const room = addRoomFootprint(harness, [[0, 0], [4, 0], [4, 3], [0, 3]]);
  const target = room.photoTargets.find(item => item.role === 'objects');
  C.registerPhotoTargetObservation(target, { frameId: 1, viewCluster: 'A', score: 0.91 });
  state.frames = [{
    id: 1,
    roomId: room.id,
    viewCluster: 'A',
    jpegDataUrl: 'data:image/jpeg;base64,AA==',
    quality: 0.8,
    status: 'captured',
    captureMode: 'manual',
    depthGrid: null,
    deepMask: null,
  }];
  room.frameIds = [1];
  room.viewClusters = ['A'];
  state.objects = [C.createManualObject('O1', 'Tavolo', [0.5, 0.5], [1.5, 1.2], 0, 0.8)];
  state.objectSequence = 1;
  api.refreshAcousticSurfaces();
  const floor = state.acousticSurfaces.find(surface => surface.id === `${room.id}:floor`);
  C.applyMaterialToSurface(floor, 'carpet', {
    mode: 'manual',
    alpha: [0.11, 0.18, 0.30, 0.44, 0.52, 0.60, 0.66],
    scattering: 0.27,
  });
  C.mergeVoxel(state.objectVoxels, [1.0, 0.7, 0.8], {
    source: 'XR', viewId: 'A', frameId: 1, roomId: room.id, color: [120, 130, 140], weight: 1.2,
  }, api.CONFIG.objectVoxelSize);

  assert.equal(await api.persistCheckpoint('unit-test'), true);
  assert.equal(state.checkpointAvailable, true);
  assert.ok(indexedDB.records.has('latest'));
  assert.ok(indexedDB.records.has('photo:1'), 'JPEG must be stored in its own IndexedDB record');
  const compact = indexedDB.records.get('latest').raw;
  assert.equal(compact.frames[0].jpegDataUrl, null, 'compact checkpoint must not inline the JPEG');
  assert.equal(compact.frames[0].checkpointPhotoKey, 'photo:1');
  assert.equal(compact.checkpointPolicy.frameImages, 'separate-indexeddb-records');
  const explicitRaw = api.buildRawSnapshot();
  assert.equal(explicitRaw.frames[0].jpegDataUrl, 'data:image/jpeg;base64,AA==', 'explicit RAW export remains self-contained');

  state.rooms = [];
  state.frames = [];
  state.objects = [];
  state.objectVoxels = new Map();
  state.activeRoomId = null;
  state.phase = 'idle';
  assert.equal(await api.restoreCheckpoint(), true);
  assert.equal(state.rooms.length, 1);
  assert.equal(state.frames.length, 1);
  assert.equal(state.frames[0].jpegDataUrl, 'data:image/jpeg;base64,AA==', 'restore hydrates the external JPEG record');
  assert.equal(state.objects.length, 1);
  assert.equal(state.objectVoxels.size, 1);
  assert.equal(state.acousticSurfaces.length, 12);
  const restoredFloor = state.acousticSurfaces.find(surface => surface.id === `${room.id}:floor`);
  assert.equal(restoredFloor.material.mode, 'manual');
  assert.deepEqual(restoredFloor.material.alpha, [0.11, 0.18, 0.30, 0.44, 0.52, 0.60, 0.66]);
  const restoredVoxel = [...state.objectVoxels.values()][0];
  assert.equal(restoredVoxel.viewIds instanceof Set, true);
  assert.equal(restoredVoxel.roomIds.has(room.id), true);
  assert.equal(state.phase, 'finished');
  const restoredTarget = state.rooms[0].photoTargets.find(item => item.id === target.id);
  assert.equal(C.photoTargetStatus(restoredTarget), 'yellow');
  assert.equal(elements.get('reviewModal').classList.contains('hidden'), false);
  assert.ok(elements.get('roomsReview').innerHTML.includes('caselle'));

  // A user may ignore an old restore button and begin a fresh scan. Numeric
  // frame IDs restart at 1, so a stale optimization set must not suppress the
  // new JPEG write or associate the new geometry with an old photograph.
  const fresh = createHarness({ indexedDB });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(fresh.state.checkpointPhotoIds.has('1'), true);
  const freshRoom = addRoomFootprint(fresh, [[0, 0], [2, 0], [2, 2], [0, 2]]);
  fresh.state.frames = [{
    id: 1,
    roomId: freshRoom.id,
    viewCluster: 'NEW',
    jpegDataUrl: 'data:image/jpeg;base64,NEW=',
    depthGrid: null,
    deepMask: null,
  }];
  assert.equal(fresh.state.frames[0].checkpointPhotoKey, undefined);
  assert.equal(await fresh.api.persistCheckpoint('fresh-scan-overwrite'), true);
  assert.equal(indexedDB.records.get('photo:1').jpegDataUrl, 'data:image/jpeg;base64,NEW=');
  assert.equal(indexedDB.records.get('latest').raw.frames[0].checkpointPhotoKey, 'photo:1');

  console.log('PASS checkpoint_recovery');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
