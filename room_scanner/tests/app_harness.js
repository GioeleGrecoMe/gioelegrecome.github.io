'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const C = require('../roomscan_core.js');
const S = require('../roomscan_signal.js');
const G = require('../roomscan_geometry.js');
const A = require('../roomscan_acoustics.js');
const AudioCapture = require('../roomscan_audio.js');

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
    this.dataset = {};
    this.classList = new FakeClassList(id && /Modal$/.test(id) ? ['hidden'] : []);
    this.listeners = new Map();
    this.value = id === 'quality' ? 'balanced' : '';
    this.checked = true;
    this.disabled = false;
    this.textContent = '';
    this.innerHTML = '';
    this.files = [];
    this.width = 390;
    this.height = 844;
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  closest() { return this; }
  click() { return this.listeners.get('click')?.({ target: this }); }
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; }
}


function createMemoryIndexedDB() {
  const databases = new Map();
  const exposedRecords = new Map();

  function asyncRequest(executor) {
    const request = { result: null, error: null, onsuccess: null, onerror: null };
    setTimeout(() => {
      try {
        request.result = executor();
        request.onsuccess?.({ target: request });
      } catch (error) {
        request.error = error;
        request.onerror?.({ target: request });
      }
    }, 0);
    return request;
  }

  function makeStore(dbName, storeName, definition, transaction) {
    const records = definition.records;
    return {
      put(value, explicitKey) {
        const keyPath = definition.keyPath;
        const key = explicitKey ?? (keyPath ? value?.[keyPath] : value?.key ?? value?.id);
        if (key == null) throw new Error(`Missing key for ${dbName}/${storeName}`);
        const cloned = typeof structuredClone === 'function' ? structuredClone(value) : value;
        records.set(key, cloned);
        if (dbName.includes('checkpoint')) exposedRecords.set(key, cloned);
        transaction._completeSoon();
        return asyncRequest(() => key);
      },
      delete(key) {
        records.delete(key);
        if (dbName.includes('checkpoint')) exposedRecords.delete(key);
        transaction._completeSoon();
        return asyncRequest(() => undefined);
      },
      clear() {
        records.clear();
        if (dbName.includes('checkpoint')) exposedRecords.clear();
        transaction._completeSoon();
        return asyncRequest(() => undefined);
      },
      get(key) {
        return asyncRequest(() => records.has(key)
          ? (typeof structuredClone === 'function' ? structuredClone(records.get(key)) : records.get(key))
          : null);
      },
    };
  }

  function makeDatabase(name, version) {
    const stores = new Map();
    const database = {
      name,
      version,
      objectStoreNames: {
        contains(storeName) { return stores.has(storeName); },
      },
      createObjectStore(storeName, options = {}) {
        if (!stores.has(storeName)) stores.set(storeName, { keyPath: options.keyPath || null, records: new Map() });
        return {};
      },
      transaction(storeName) {
        if (!stores.has(storeName)) throw new Error(`Store ${storeName} does not exist`);
        let completionScheduled = false;
        const transaction = {
          oncomplete: null,
          onerror: null,
          onabort: null,
          error: null,
          _completeSoon() {
            if (completionScheduled) return;
            completionScheduled = true;
            setTimeout(() => transaction.oncomplete?.({ target: transaction }), 2);
          },
          objectStore(requested) {
            return makeStore(name, requested, stores.get(requested), transaction);
          },
        };
        // Read-only transactions that only attach a request handler still need
        // a completion callback after the request has had time to resolve.
        setTimeout(() => transaction._completeSoon(), 1);
        return transaction;
      },
      close() {},
      _stores: stores,
    };
    return database;
  }

  return {
    records: exposedRecords,
    databases,
    open(name = 'default', version = 1) {
      const request = { result: null, error: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null };
      setTimeout(() => {
        try {
          let database = databases.get(name);
          const needsUpgrade = !database || version > database.version;
          if (!database) {
            database = makeDatabase(name, version);
            databases.set(name, database);
          } else if (version > database.version) {
            database.version = version;
          }
          request.result = database;
          if (needsUpgrade) request.onupgradeneeded?.({ target: request });
          request.onsuccess?.({ target: request });
        } catch (error) {
          request.error = error;
          request.onerror?.({ target: request });
        }
      }, 0);
      return request;
    },
  };
}

function createHarness(options = {}) {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'room_scanner_v12.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'roomscan_app.js'), 'utf8');
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  const elements = new Map(ids.map(id => [id, new FakeElement(id)]));
  for (const id of ['processModal', 'planModal', 'sceneModal', 'reviewModal', 'hud', 'arCanvas', 'overlayCanvas', 'screenTint']) {
    elements.get(id)?.classList.add('hidden');
  }
  elements.get('heightValue').value = '2.70';
  elements.get('manualHeight').value = '0.80';

  let domReady = null;
  const documentListeners = new Map();
  const windowListeners = new Map();
  const document = {
    title: 'Room Scanner test',
    readyState: 'loading',
    visibilityState: 'visible',
    activeElement: null,
    body: new FakeElement('body'),
    documentElement: { requestFullscreen: () => Promise.resolve() },
    fullscreenElement: null,
    getElementById: id => elements.get(id) || null,
    querySelectorAll: () => [],
    createElement: tag => new FakeElement(tag),
    addEventListener: (type, listener) => {
      documentListeners.set(type, listener);
      if (type === 'DOMContentLoaded') domReady = listener;
    },
  };
  const alerts = [];
  const confirms = [];
  const history = options.history || {
    states: [],
    backCalls: 0,
    pushState(value) { this.states.push(value); },
    back() { this.backCalls += 1; },
  };
  const storageRecords = new Map();
  const sessionStorage = options.sessionStorage || {
    getItem(key) { return storageRecords.has(key) ? storageRecords.get(key) : null; },
    setItem(key, value) { storageRecords.set(key, String(value)); },
    removeItem(key) { storageRecords.delete(key); },
  };
  const location = { reloadCalls: 0, reload() { this.reloadCalls += 1; }, href: 'https://example.test/room_scanner_v12.html' };
  const context = {
    RoomScanCore: C,
    RoomScanSignal: S,
    RoomScanGeometry: G,
    RoomScanAcoustics: A,
    RoomScanAudio: AudioCapture,
    document,
    navigator: options.navigator || {},
    location,
    sessionStorage,
    history,
    console,
    Date,
    Math,
    JSON,
    Promise,
    Map,
    Set,
    Array,
    ArrayBuffer,
    Float32Array,
    Float64Array,
    Int16Array,
    Int32Array,
    Uint16Array,
    Uint32Array,
    Uint8Array,
    Uint8ClampedArray,
    structuredClone,
    performance,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: callback => setTimeout(() => callback(Date.now()), 0),
    cancelAnimationFrame: clearTimeout,
    alert(message) { alerts.push(String(message)); },
    confirm(message) { confirms.push(String(message)); return Boolean(options.confirmResult); },
    URL,
    Blob,
  };
  if (options.indexedDB) context.indexedDB = options.indexedDB;
  context.window = context;
  context.window.isSecureContext = true;
  context.window.addEventListener = (type, listener) => windowListeners.set(type, listener);
  context.window.removeEventListener = type => windowListeners.delete(type);
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(app, context, { filename: 'roomscan_app.js' });
  if (typeof domReady !== 'function') throw new Error('DOMContentLoaded handler missing');
  domReady();
  return {
    C,
    S,
    G,
    A,
    AudioCapture,
    root,
    html,
    app,
    context,
    api: context.__ROOM_SCANNER_V20__ || context.__ROOM_SCANNER_V15__,
    state: (context.__ROOM_SCANNER_V20__ || context.__ROOM_SCANNER_V15__).state,
    elements,
    alerts,
    confirms,
    history,
    windowListeners,
    documentListeners,
    sessionStorage,
    storageRecords,
    location,
  };
}

function addRoomFootprint(harness, points, height = 2.7) {
  const { api, state, elements } = harness;
  api.beginRoom();
  for (const point of points) {
    state.aimPoint = [point[0], 0, point[1]];
    state.aimSamples = [];
    api.addCorner();
  }
  api.closeRoom();
  elements.get('heightValue').value = String(height);
  api.confirmHeight(false);
  return state.rooms[state.rooms.length - 1];
}

module.exports = { createHarness, addRoomFootprint, createMemoryIndexedDB, FakeClassList, FakeElement };
