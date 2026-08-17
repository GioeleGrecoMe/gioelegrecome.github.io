'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const C = require('../roomscan_core.js');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'room_scanner_v12.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'roomscan_app.js'), 'utf8');
const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);

class FakeClassList {
  constructor(classes = []) { this.values = new Set(classes); }
  add(...classes) { classes.forEach(value => this.values.add(value)); }
  remove(...classes) { classes.forEach(value => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const enabled = force === undefined ? !this.values.has(value) : Boolean(force);
    if (enabled) this.values.add(value); else this.values.delete(value);
    return enabled;
  }
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.style = {};
    this.classList = new FakeClassList(id && /Modal$/.test(id) ? ['hidden'] : []);
    this.listeners = new Map();
    this.value = id === 'quality' ? 'balanced' : '';
    this.checked = true;
    this.disabled = false;
    this.textContent = '';
    this.innerHTML = '';
    this.files = [];
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  closest() { return this; }
  click() { this.listeners.get('click')?.({ target: this }); }
  setPointerCapture() {}
}

const elements = new Map(ids.map(id => [id, new FakeElement(id)]));
for (const id of ['processModal', 'planModal', 'sceneModal', 'reviewModal', 'hud', 'arCanvas', 'overlayCanvas', 'screenTint']) {
  elements.get(id)?.classList.add('hidden');
}
elements.get('heightValue').value = '2.70';
elements.get('manualHeight').value = '0.80';

let domReady = null;
const alerts = [];
const document = {
  readyState: 'loading',
  activeElement: null,
  body: new FakeElement('body'),
  documentElement: { requestFullscreen: () => Promise.resolve() },
  fullscreenElement: null,
  getElementById: id => elements.get(id) || null,
  querySelectorAll: () => [],
  addEventListener: (type, listener) => { if (type === 'DOMContentLoaded') domReady = listener; },
};
const context = {
  RoomScanCore: C,
  document,
  navigator: {},
  location: { reload() {} },
  console,
  Date,
  Math,
  JSON,
  Promise,
  Map,
  Set,
  Array,
  Float32Array,
  Uint8Array,
  Uint8ClampedArray,
  setTimeout,
  clearTimeout,
  alert(message) { alerts.push(String(message)); },
  confirm() { return false; },
};
context.window = context;
context.window.isSecureContext = true;
context.window.addEventListener = () => {};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(app, context, { filename: 'roomscan_app.js' });
domReady();

const api = context.__ROOM_SCANNER_V15__;
const state = api.state;

function addFootprint(points) {
  for (const point of points) {
    state.aimSamples = [];
    state.aimPoint = [point[0], 0, point[1]];
    api.addCorner();
  }
}

function addCoverageFrames(roomId, startId) {
  for (let index = 0; index < 3; index += 1) {
    state.frames.push({
      id: startId + index,
      roomId,
      viewCluster: `view-${roomId}-${index}`,
    });
  }
}

// First room: all dimensions are already in the shared local-floor frame.
api.beginRoom();
assert.equal(state.phase, 'corners');
assert.equal(state.activeRoomId, 'R1');
addFootprint([[0, 0], [4, 0], [4, 3], [0, 3]]);
api.closeRoom();
assert.equal(state.phase, 'height');
assert.ok(Math.abs(state.rooms[0].model.area - 12) < 1e-9);
api.confirmHeight(false);
assert.equal(state.phase, 'coverage');
addCoverageFrames('R1', 1);
api.completeRoom();
assert.equal(state.phase, 'room-ready');

// Walk through the east wall. The path determines the source side of the
// doorway; no second-room registration or free rotation is introduced.
state.currentCamera = { position: [2, 1.45, 1.5], yaw: 0, pitch: 0 };
api.beginTransition();
state.transition.path = [[2, 1.5], [3.8, 1.5], [4.35, 1.5]];
state.transition.crossing = C.pathBoundaryCrossing(state.transition.path, state.rooms[0].model);
assert.equal(state.transition.crossing.kind, 'exit');
state.currentCamera = { position: [4.35, 1.45, 1.5], yaw: 0, pitch: 0 };
api.finishTransition();
assert.equal(state.phase, 'corners');
assert.equal(state.activeRoomId, 'R2');
assert.equal(state.portals.length, 1);
assert.equal(state.portals[0].sourceRoomId, 'R1');
assert.equal(state.pendingPortalId, 'P1');

// Second room shares the doorway wall in the same metric frame. Closing the
// footprint must link both sides of the portal automatically.
addFootprint([[4, 0], [7, 0], [7, 3], [4, 3]]);
api.closeRoom();
assert.equal(state.phase, 'height');
assert.equal(state.pendingPortalId, null);
assert.equal(state.portals[0].targetRoomId, 'R2');
assert.equal(state.portals[0].sides.length, 2);
assert.deepEqual(new Set(state.portals[0].sides.map(side => side.roomId)), new Set(['R1', 'R2']));
assert.ok(state.portals[0].width >= 0.55 && state.portals[0].width <= 1.05);

api.confirmHeight(false);
addCoverageFrames('R2', 4);
api.completeRoom();
assert.equal(state.phase, 'room-ready');
assert.equal(state.rooms.filter(room => room.status === 'complete').length, 2);
assert.equal(alerts.length, 0, alerts.join('\n'));

console.log('PASS workflow_state');
