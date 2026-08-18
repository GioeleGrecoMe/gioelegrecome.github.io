'use strict';

const assert = require('assert');
const { createHarness, addRoomFootprint, createMemoryIndexedDB } = require('./app_harness.js');

(async () => {
  const indexedDB = createMemoryIndexedDB();
  const harness = createHarness({ indexedDB });
  const { api, state, elements, history, location } = harness;
  await new Promise(resolve => setTimeout(resolve, 15));
  const room = addRoomFootprint(harness, [[0, 0], [4, 0], [4, 3], [0, 3]]);
  state.frames = [
    { id: 1, roomId: room.id, viewCluster: 'A', jpegDataUrl: 'data:image/jpeg;base64,AA==' },
    { id: 2, roomId: room.id, viewCluster: 'B' },
    { id: 3, roomId: room.id, viewCluster: 'B' },
  ];

  const order = [];
  state.captureBusy = true;
  state.capturePromise = new Promise(resolve => {
    setTimeout(() => {
      order.push('capture-settled');
      state.captureBusy = false;
      resolve(null);
    }, 12);
  });
  let endCalls = 0;
  state.session = { end: async () => { order.push('xr-end'); endCalls += 1; } };
  state.historyGuardActive = true;

  const handled = await api.handleBrowserBack();
  assert.equal(handled, true);
  assert.equal(endCalls, 1, 'Back must end the existing XR session only once');
  assert.deepEqual(order, ['capture-settled', 'xr-end'], 'capture must settle before XR ends');
  assert.equal(state.phase, 'finished');
  assert.equal(room.status, 'partial');
  assert.equal(state.captureSuspended, true, 'suspension remains until the XR end event');
  assert.equal(indexedDB.records.has('latest'), false, 'no structured clone may start while WebXR is alive');

  await api.onXREnd();
  assert.equal(state.session, null);
  assert.equal(state.navigationExitPending, false);
  assert.equal(state.captureSuspended, false);
  assert.equal(state.postXrReady, true, 'processing is enabled after same-document cleanup and persistence');
  assert.equal(state.handoffPending, false);
  assert.ok(indexedDB.records.has('latest'));
  assert.ok(indexedDB.records.has('photo:1'));
  assert.equal(indexedDB.records.get('latest').raw.frames[0].jpegDataUrl, null);
  assert.equal(indexedDB.records.get('latest').raw.frames[0].checkpointPhotoKey, 'photo:1');
  assert.equal(elements.get('reviewModal').classList.contains('hidden'), false, 'review opens in the same document');
  assert.equal(elements.get('processModel').disabled, false);
  assert.equal(history.backCalls, 0);
  assert.equal(location.reloadCalls, 0, 'normal XR exit must never reload the page');

  console.log('PASS navigation_recovery');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
