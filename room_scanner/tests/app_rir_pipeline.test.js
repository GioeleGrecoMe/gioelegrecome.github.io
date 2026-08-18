'use strict';

const assert = require('assert');
const { createHarness, addRoomFootprint } = require('./app_harness.js');

(async () => {
  const harness = createHarness();
  const room = addRoomFootprint(harness, [[0, 0], [5, 0], [5, 4], [0, 4]], 2.7);
  room.status = 'complete';
  harness.api.refreshAcousticSurfaces();

  const S = harness.S;
  const sampleRate = 24000;
  const sweep = S.generateESS(sampleRate, 150, 10000, 0.14, 0.45, 0.006).samples;
  const source = [0.70, 1.30, 2.20];
  const receiver = [0.78, 1.35, 2.20];
  const directLength = Math.hypot(...receiver.map((value, index) => value - source[index]));
  const imageSourceLength = Math.hypot(receiver[0] + source[0], receiver[1] - source[1], receiver[2] - source[2]);
  const wallDelaySeconds = (imageSourceLength - directLength) / 343;

  const impulse = new Float32Array(3000);
  impulse[0] = 0.20;
  impulse[Math.round(wallDelaySeconds * sampleRate)] = 0.55;
  impulse[700] = 0.15;
  const response = S.convolve(sweep, impulse);
  const expectedOnsetSample = 700;
  const hardwareLagSamples = 1300;
  const recording = new Float32Array(expectedOnsetSample + hardwareLagSamples + response.length + 300);
  recording.set(response, expectedOnsetSample + hardwareLagSamples);

  const controller = new harness.AudioCapture.AcousticCaptureController();
  controller.measurements = [{
    id: 'M1',
    sampleRate,
    recording: S.floatToInt16(recording),
    recordingStartFrame: 0,
    expectedOnsetSample,
    sweep,
    sweepConfig: { f0: 150, f1: 10000, durationSeconds: 0.14, amplitude: 0.45, fadeSeconds: 0.006 },
    roomId: room.id,
    sourceMode: 'fixed',
    sourcePosition: source,
    receiverPosition: receiver,
    receiverPoseAtSchedule: { t: 0, p: receiver, q: [0, 0, 0, 1], confidence: 1 },
    poseConfidence: 1,
    scheduledPerformanceTime: 0,
    audioSettings: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    captureCoverage: 1,
  }];
  harness.state.audioController = controller;
  harness.state.audio.enabled = true;
  harness.state.audio.manifests = controller.measurements.map(record => controller.measurementManifest(record));

  const result = await harness.api.processAcousticMeasurements();
  assert.deepEqual(result, { measurements: 1, successful: 1 });
  const analysis = harness.state.rirAnalyses[0];
  assert.equal(analysis.ok, true);
  assert.equal(analysis.latency.directAligned, true);
  assert.ok(Math.abs(analysis.latency.detectedOnsetSample - (expectedOnsetSample + hardwareLagSamples)) < 0.25);
  assert.ok(analysis.latency.residualElectroacousticLatencySeconds > 0.04);

  const wallEcho = analysis.associations.reduce((best, association) => (
    Math.abs(association.peak.delaySeconds - wallDelaySeconds)
      < Math.abs((best?.peak.delaySeconds ?? Infinity) - wallDelaySeconds)
      ? association : best
  ), null);
  assert.ok(wallEcho);
  assert.ok(Math.abs(wallEcho.peak.delaySeconds - wallDelaySeconds) < 1 / sampleRate);
  assert.equal(wallEcho.candidates[0].ownerSurfaceId, `${room.id}:wall:3`);
  assert.ok(wallEcho.candidates[0].posterior > wallEcho.unassignedPosterior);
  assert.ok(wallEcho.candidates[0].posterior > 0.35);

  const inferredWall = harness.state.acousticSurfaces.find(surface => surface.id === `${room.id}:wall:3`);
  assert.equal(inferredWall.material.mode, 'inferred');
  assert.equal(inferredWall.material.source, 'rir-zone-inference');
  assert.ok(inferredWall.zoneIds.length > 0);

  console.log('PASS app_rir_pipeline');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
