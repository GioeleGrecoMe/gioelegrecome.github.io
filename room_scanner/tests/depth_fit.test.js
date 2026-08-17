'use strict';

const assert = require('assert');
const C = require('../roomscan_core.js');

// Direct relative-depth family with deterministic contamination.
const directSamples = [];
for (let i = 1; i <= 80; i += 1) {
  const relative = 0.05 * i;
  const metric = 0.65 + 1.72 * relative + 0.012 * Math.sin(i);
  directSamples.push({ relative, metric, weight: i % 4 === 0 ? 4 : 1 });
}
directSamples.push(
  { relative: 0.4, metric: 8.8, weight: 1 },
  { relative: 2.8, metric: 0.3, weight: 1 },
  { relative: 3.3, metric: 8.7, weight: 1 },
);
const direct = C.fitRelativeDepth(directSamples);
assert.ok(direct);
assert.equal(direct.mode, 'direct');
assert.ok(Math.abs(direct.slope - 1.72) < 0.03, JSON.stringify(direct));
assert.ok(Math.abs(direct.intercept - 0.65) < 0.04, JSON.stringify(direct));
assert.ok(direct.medianError < 0.03, JSON.stringify(direct));
assert.ok(Math.abs(C.metricDepth(direct, 2.2) - (0.65 + 1.72 * 2.2)) < 0.06);

// Inverse relative-depth family, representing models whose output increases
// toward the camera. The fitter evaluates both parameterizations and chooses
// the one with lower robust residual.
const inverseSamples = [];
for (let i = 1; i <= 90; i += 1) {
  const relative = 0.18 + i * 0.022;
  const metric = 0.28 + 3.15 / relative + 0.008 * Math.cos(i * 0.7);
  inverseSamples.push({ relative, metric, weight: i % 5 === 0 ? 3 : 1 });
}
inverseSamples.push(
  { relative: 0.25, metric: 0.2, weight: 1 },
  { relative: 1.4, metric: 8.6, weight: 1 },
);
const inverse = C.fitRelativeDepth(inverseSamples);
assert.ok(inverse);
assert.equal(inverse.mode, 'inverse');
assert.ok(Math.abs(inverse.slope - 3.15) < 0.04, JSON.stringify(inverse));
assert.ok(Math.abs(inverse.intercept - 0.28) < 0.04, JSON.stringify(inverse));
assert.ok(inverse.p90Error < 0.03, JSON.stringify(inverse));

// Underdetermined sets are rejected rather than given a convincing scale.
assert.equal(C.fitRelativeDepth([{ relative: 1, metric: 2 }]), null);

console.log('PASS depth_fit');
