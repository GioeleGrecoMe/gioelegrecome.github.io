'use strict';

const assert = require('assert');
const { createHarness } = require('./app_harness.js');

const harness = createHarness();
const { api, state, elements } = harness;
const calls = [];
state.hitTestSource = { cancel() { calls.push('hit-cancel'); } };
state.cameraReader = { dispose() { calls.push('camera-dispose'); } };
state.anchors = [{ delete() { calls.push('anchor-delete'); } }];
state.gl = {
  FRAMEBUFFER: 1,
  bindFramebuffer() { calls.push('unbind-framebuffer'); },
  finish() { calls.push('gl-finish'); },
  getExtension(name) {
    assert.equal(name, 'WEBGL_lose_context');
    return { loseContext() { calls.push('lose-context'); } };
  },
};
state.frames = [{ id: 1, rgba: new Uint8Array([1, 2, 3, 4]), deep: { data: new Float32Array([1]) } }];
elements.get('arCanvas').width = 1080;
elements.get('arCanvas').height = 1920;
api.cleanupXRResources();

for (const expected of ['hit-cancel', 'camera-dispose', 'anchor-delete', 'unbind-framebuffer', 'gl-finish', 'lose-context']) {
  assert.ok(calls.includes(expected), `missing cleanup call ${expected}`);
}
assert.equal(state.gl, null);
assert.equal(state.cameraReader, null);
assert.equal(state.hitTestSource, null);
assert.equal(state.frames[0].rgba, null);
assert.equal(state.frames[0].deep, null);
assert.equal(elements.get('arCanvas').width, 1);
assert.equal(elements.get('arCanvas').height, 1);

console.log('PASS post_xr_cleanup');
