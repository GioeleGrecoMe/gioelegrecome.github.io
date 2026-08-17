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
elements.get('processModal').classList.add('hidden');
elements.get('hud').classList.add('hidden');
elements.get('arCanvas').classList.add('hidden');
elements.get('overlayCanvas').classList.add('hidden');
elements.get('screenTint').classList.add('hidden');
elements.get('heightValue').value = '2.70';
elements.get('manualHeight').value = '0.80';

let domReady = null;
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
const windowListeners = new Map();
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
  alert() {},
  confirm() { return false; },
};
context.window = context;
context.window.isSecureContext = true;
context.window.addEventListener = (type, listener) => windowListeners.set(type, listener);
context.globalThis = context;
vm.createContext(context);
vm.runInContext(app, context, { filename: 'roomscan_app.js' });
assert.equal(typeof domReady, 'function');
domReady();

assert.ok(context.__ROOM_SCANNER_V15__);
assert.equal(context.__ROOM_SCANNER_V15__.VERSION, '15.0.0');
assert.equal(context.__ROOM_SCANNER_V15__.state.initialized, true);
assert.equal(elements.get('landingSummary').textContent, 'Nessuna scansione in memoria.');
assert.ok(elements.get('startXR').listeners.has('click'));
assert.ok(elements.get('newScan').listeners.has('click'));
assert.ok(elements.get('planCanvas').listeners.has('pointerdown'));
assert.ok(windowListeners.has('resize'));

console.log('PASS bootstrap');
