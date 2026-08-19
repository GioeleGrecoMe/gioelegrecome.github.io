import test from 'node:test';
import assert from 'node:assert/strict';
import { CalibrationVerificationOverlay } from '../src/calibration-overlay.js';
import { wireCalibrationControls } from '../src/calibration-controls.js';

class FakeElement extends EventTarget {
  constructor(tag='div') {
    super();
    this.tagName = tag.toUpperCase();
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.textContent = '';
    this.value = '';
    this.files = [];
    this.parentNode = null;
    this.removed = false;
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    for (const child of children) this.appendChild(child);
  }
  remove() {
    this.removed = true;
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x)=>x!==this);
    this.parentNode = null;
  }
  click() { this.dispatchEvent(new Event('click')); }
}

function installFakeDocument() {
  const original = globalThis.document;
  const body = new FakeElement('body');
  globalThis.document = {
    body,
    createElement: (tag) => new FakeElement(tag),
  };
  return () => { globalThis.document = original; };
}

class FakeManager extends EventTarget {
  constructor() {
    super();
    this.saved = [];
    this.loaded = [];
    this.verifyCalls = 0;
    this.captureCalls = 0;
    this.improveCalls = 0;
  }
  getStatus() {
    return {
      state:'verified', pins:4, runtimeAnchors:4,
      frame:{visibleCount:3}, coverage:{qualifyingPoses:3,requiredPoses:3}, calibrated:true,
    };
  }
  verifyCurrentFrame() { this.verifyCalls++; return {ok:true}; }
  captureCalibrationPose() { this.captureCalls++; return {accepted:true,sample:{id:'r1'}}; }
  async improve() { this.improveCalls++; return {accepted:true}; }
  saveProfile(name) { this.saved.push(name); }
  loadProfile(name) { this.loaded.push(name); return {profileName:name}; }
  downloadProfile() {}
  async importProfile() {}
}

test('verification overlay renders normalized WebXR pin positions without external DOM dependencies', () => {
  const restore = installFakeDocument();
  try {
    const container = new FakeElement('main');
    const overlay = new CalibrationVerificationOverlay(container);
    assert.equal(container.children.length,1);
    overlay.show();
    overlay.update([
      {pinId:'a',label:'A',u:0.25,v:0.75},
      {pinId:'b',label:'B',u:0.5,v:0.5},
      {pinId:'c',label:'C',u:0.8,v:0.2},
    ]);
    assert.equal(overlay.root.children.length,3);
    assert.equal(overlay.root.children[0].style.left,'25%');
    assert.equal(overlay.root.children[0].style.top,'75%');
    assert.equal(overlay.root.children[2].dataset.pinId,'c');
    overlay.hide();
    assert.equal(overlay.root.style.display,'none');
    assert.equal(overlay.root.children.length,0);
    overlay.destroy();
    assert.equal(container.children.length,0);
  } finally { restore(); }
});


test('verification overlay bind refreshes projected positions on every frameupdate', () => {
  const restore = installFakeDocument();
  try {
    class ProjectionManager extends EventTarget {
      constructor() { super(); this.u = 0.2; }
      getVerificationOverlay() { return [{pinId:'a',label:'A',u:this.u,v:0.5}]; }
      next(u) { this.u = u; this.dispatchEvent(new Event('frameupdate')); }
    }
    const manager = new ProjectionManager();
    const overlay = new CalibrationVerificationOverlay(document.body);
    overlay.show();
    overlay.bind(manager);
    assert.equal(overlay.root.children[0].style.left,'20%');
    manager.next(0.7);
    assert.equal(overlay.root.children[0].style.left,'70%');
    overlay.destroy();
  } finally { restore(); }
});

test('save/load/verify/improve controls call the manager and expose diagnostic status', async () => {
  const manager = new FakeManager();
  const verifyButton = new FakeElement('button');
  const improveButton = new FakeElement('button');
  const saveButton = new FakeElement('button');
  const loadButton = new FakeElement('button');
  const statusElement = new FakeElement('output');
  wireCalibrationControls(manager, {
    verifyButton, improveButton, saveButton, loadButton, statusElement, profileName:'debug-room',
  });
  assert.match(statusElement.textContent,/visibili=3/);
  assert.match(statusElement.textContent,/pose=3\/3/);
  verifyButton.click();
  saveButton.click();
  loadButton.click();
  improveButton.click();
  // improve listener is async, yield once for its continuation.
  await Promise.resolve();
  assert.equal(manager.verifyCalls,1);
  assert.deepEqual(manager.saved,['debug-room']);
  assert.deepEqual(manager.loaded,['debug-room']);
  assert.equal(manager.captureCalls,1);
  assert.equal(manager.improveCalls,1);
});
