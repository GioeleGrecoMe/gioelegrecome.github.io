'use strict';

const assert = require('assert');
const C = require('../roomscan_core.js');
const G = require('../roomscan_geometry.js');

function testMode(mode) {
  const anchors = [];
  for (let index = 0; index < 30; index += 1) {
    const metric = 0.5 + index * 0.1;
    const relative = mode === 'direct'
      ? (metric - 0.2) / 1.7
      : 1 / (metric * 1.3 + 0.1);
    anchors.push({ relativeDepth: relative, metricDepth: metric, weight: index % 5 === 0 ? 0.3 : 1 });
  }
  anchors.push({ relativeDepth: mode === 'direct' ? 9 : 0.9, metricDepth: 8, weight: 0.1 });
  const fit = G.metricScaleRelativeDepth(null, anchors);
  assert.equal(fit.ok, true);
  assert.equal(fit.mode, mode);
  assert.ok(fit.medianAbsoluteError < 0.01);
  assert.ok(fit.p90Error < 0.03);
  for (const anchor of anchors.slice(0, 30)) {
    assert.ok(Math.abs(C.metricDepth(fit, anchor.relativeDepth) - anchor.metricDepth) < 0.025);
  }
}

testMode('direct');
testMode('inverse');
assert.equal(G.metricScaleRelativeDepth(null, [{ relativeDepth: 1, metricDepth: 2 }]).ok, false);

console.log('PASS deep_metric_scaling');
