'use strict';

const assert = require('assert');

// The module is designed to install safely even outside a browser. Node has no
// document/localStorage/IndexedDB here, which verifies that diagnostics cannot
// become a hard dependency of the scanner pipeline.
const D = require('../roomscan_diagnostics.js');
assert.ok(D);
assert.equal(D.BUILD, 'v20.1.0-diagnostics-20260818');

D.recordAppLog('UNIT_TEST_EVENT', 'INFO', { phase: 'coverage', count: 3 });
assert.ok(D.events.some(entry => entry.type === 'APP:UNIT_TEST_EVENT'));

const encoded = D.jsonSafe(new Int16Array([1, -2, 32767, -32768]));
assert.equal(encoded.__type, 'Int16Array');
assert.equal(encoded.length, 4);
assert.ok(typeof encoded.base64 === 'string' && encoded.base64.length > 0);

(async () => {
  const records = D.diagnosticRecords({ trigger: 'unit-test' });
  const first = await records.next();
  assert.equal(first.done, false);
  assert.equal(first.value.type, 'diagnostic-header');
  assert.equal(first.value.data.schema, 'room-scanner-v20-diagnostic-jsonl-v1');
  const second = await records.next();
  assert.equal(second.value.type, 'environment');
  await records.return?.();
  console.log('PASS diagnostics_export');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
