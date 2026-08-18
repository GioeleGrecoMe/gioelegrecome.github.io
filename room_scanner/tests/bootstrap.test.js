'use strict';

const assert = require('assert');
const { createHarness } = require('./app_harness.js');

const harness = createHarness();
const { api, state, elements, windowListeners } = harness;
assert.ok(api);
assert.equal(api.VERSION, '20.1.0');
assert.equal(api.REVISION, 'v20.1.0-metric-rir-twin-20260818');
assert.equal(state.initialized, true);
assert.equal(elements.get('landingSummary').textContent, 'Nessuna scansione in memoria.');
assert.ok(elements.get('startXR').listeners.has('click'));
assert.ok(elements.get('resumeCheckpoint').listeners.has('click'));
assert.ok(elements.get('planCanvas').listeners.has('pointerdown'));
assert.ok(elements.get('applyAcoustic').listeners.has('click'));
assert.ok(elements.get('exportAcousticJson').listeners.has('click'));
assert.ok(windowListeners.has('resize'));
assert.ok(windowListeners.has('popstate'));
assert.ok(windowListeners.has('pagehide'));

console.log('PASS bootstrap');
