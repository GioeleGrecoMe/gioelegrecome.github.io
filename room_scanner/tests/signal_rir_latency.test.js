'use strict';

const assert = require('assert');
const S = require('../roomscan_signal.js');

const sampleRate = 24000;
const sweepDescriptor = S.generateESS(sampleRate, 150, 10000, 0.14, 0.45, 0.006);
assert.ok(sweepDescriptor.samples instanceof Float32Array);
assert.ok(sweepDescriptor.samples.length > 2000);

function runSynthetic(hardwareLagSamples) {
  // Deliberately make the first wall reflection stronger than the direct path.
  // The onset detector must still choose the earliest significant correlation
  // peak, while relative RIR delays must not depend on the common hardware lag.
  const impulse = new Float32Array(900);
  impulse[0] = 0.12;
  impulse[240] = 0.55; // 10 ms
  impulse[600] = 0.20; // 25 ms
  const response = S.convolve(sweepDescriptor.samples, impulse);
  const expectedStart = 700;
  const recording = new Float32Array(expectedStart + hardwareLagSamples + response.length + 300);
  recording.set(response, expectedStart + hardwareLagSamples);
  for (let index = 0; index < recording.length; index += 1) recording[index] += 1e-6 * Math.sin(index * 0.43);

  const detection = S.detectSweepOnsets(recording, sweepDescriptor.samples, [expectedStart], {
    sampleRate,
    minLagSeconds: 0,
    maxLagSeconds: 0.20,
    minimumScore: 0.03,
  })[0];
  assert.equal(detection.found, true);
  assert.equal(detection.selection, 'earliest-significant');
  assert.ok(Math.abs(detection.lagSamples - hardwareLagSamples) < 0.25, `${detection.lagSamples} vs ${hardwareLagSamples}`);

  const extracted = S.extractSweepRIR(recording, sweepDescriptor.samples, detection.onsetSample, sampleRate, {
    tailSeconds: 0.08,
    fLow: 100,
    fHigh: 10000,
  });
  const peaks = S.detectEchoPeaks(extracted.ir, sampleRate, extracted.directIndex, {
    minimumDelayMs: 4,
    maximumDelayMs: 40,
    minimumSnrDb: 2,
    maximumPeaks: 10,
  });
  const firstWall = peaks.reduce((best, peak) => (
    Math.abs(peak.delayMs - 10) < Math.abs((best?.delayMs ?? Infinity) - 10) ? peak : best
  ), null);
  assert.ok(firstWall);
  assert.ok(Math.abs(firstWall.delayMs - 10) < 0.15, `wall echo ${firstWall.delayMs} ms`);
  return { detection, extracted, firstWall };
}

const a = runSynthetic(1300);
const b = runSynthetic(3100);
assert.ok(Math.abs(a.firstWall.delayMs - b.firstWall.delayMs) < 1e-9, 'relative echo delay changed with hardware latency');
assert.ok(Math.abs((b.detection.lagSamples - a.detection.lagSamples) - 1800) < 0.3);

console.log('PASS signal_rir_latency');
