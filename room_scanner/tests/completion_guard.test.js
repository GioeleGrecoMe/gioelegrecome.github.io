'use strict';

const assert = require('assert');
const { createHarness, addRoomFootprint } = require('./app_harness.js');

(async () => {
  const harness = createHarness();
  const { api, state, elements, alerts } = harness;
  api.CONFIG.actionLockMs = 5;
  api.CONFIG.finishArmMs = 80;
  const room = addRoomFootprint(harness, [[0, 0], [4, 0], [4, 3], [0, 3]]);
  state.frames = [
    { id: 1, roomId: room.id, viewCluster: 'A' },
    { id: 2, roomId: room.id, viewCluster: 'B' },
    { id: 3, roomId: room.id, viewCluster: 'B' },
  ];

  state.captureBusy = true;
  assert.equal(api.completeRoom(), false);
  assert.equal(state.phase, 'coverage');
  assert.equal(state.completionPending, true);
  assert.equal(elements.get('secondaryButton').textContent, 'Salvo e completo...');

  state.captureBusy = false;
  state.captureRequest = null;
  assert.equal(api.completeRoom(), true);
  assert.equal(state.phase, 'room-ready');

  let endCalls = 0;
  state.session = { end: async () => { endCalls += 1; } };
  state.actionLockUntil = 0;
  api.armOrFinishAcquisition();
  assert.equal(endCalls, 0);
  assert.ok(state.finishArmUntil > Date.now());
  state.actionLockUntil = 0;
  api.armOrFinishAcquisition();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(endCalls, 1);
  assert.equal(state.phase, 'finished');
  assert.equal(alerts.length, 0, alerts.join('\n'));

  console.log('PASS completion_guard');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
