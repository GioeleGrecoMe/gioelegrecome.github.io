'use strict';

const assert = require('assert');
const { createHarness, addRoomFootprint } = require('./app_harness.js');

const harness = createHarness();
const { api, state, elements } = harness;
const room = addRoomFootprint(harness, [[0, 0], [4, 0], [4, 3], [0, 3]]);
const near = 0.1;
const far = 20;
state.currentProjection = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, -(far + near) / (far - near), -1,
  0, 0, -2 * far * near / (far - near), 0,
];
state.currentPoseMatrix = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  2, 1.35, 2, 1,
];
state.currentWorldToView = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  -2, -1.35, -2, 1,
];
state.currentCamera = { position: [2, 1.35, 2], yaw: -Math.PI / 2, pitch: 0 };
state.motion.linear = 0;
state.motion.angular = 0;
state.phase = 'coverage';
state.activeRoomId = room.id;

const text = [];
let fills = 0;
let strokes = 0;
const context = {
  save() {}, restore() {}, setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
  arc() {}, setLineDash() {}, fillRect() {}, strokeRect() {},
  fill() { fills += 1; },
  stroke() { strokes += 1; },
  fillText(value) { text.push(String(value)); },
  measureText(value) { return { width: String(value).length * 7 }; },
  lineWidth: 1, lineCap: 'butt', strokeStyle: '', fillStyle: '', font: '', textAlign: '', textBaseline: '',
};
const overlay = elements.get('overlayCanvas');
overlay.classList.remove('hidden');
overlay.getContext = type => type === '2d' ? context : null;
overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 844 });
api.renderOverlay();

assert.ok(fills > 0, 'wall targets should draw translucent quadrilateral fills');
assert.ok(strokes > 0, 'wall targets should draw visible outlines');
assert.ok(text.some(value => value.includes('FOTO')), 'selected red target should expose its photo count');
assert.ok(text.some(value => value.includes('rosse')), 'overlay should expose red/yellow/green totals');

console.log('PASS overlay_render');
