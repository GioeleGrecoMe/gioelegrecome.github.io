# V30.38 validation report

Validation date: 2026-08-21

## Full Node regression suite

`npm test`

- total: **169**
- pass: **168**
- fail: **1**
- skipped: **0**

The only failure is the pre-existing filesystem contract that executes `stat()` on:

`models/model_q4.onnx`

The supplied project intentionally omits `models/`, so the failure is expected and unrelated to V30.38 code.

## V30.38 live optimiser tests

Dedicated tests cover:

- small accepted pose/reprojection improvement;
- catastrophic pose jump rejection even when scalar energy decreases;
- reprojection-regression rejection;
- pose-delta comparison only over common persistent frame IDs;
- bounded live graph window;
- old useful loop endpoint recovery;
- graph-window diagnostics;
- dedicated live worker / accepted-working split contract;
- structured diagnostics, checkpoints, monotonic sequence, runtime context and diagnostic summary.

All pass.

## Public-data regression

`npm run check:public` — **PASS**

TUM RGB-D `freiburg1_xyz` fixture:

- 85 / 86 correct feature matches;
- precision: **98.8372%**;
- recall: **100%**;
- factor-graph frames: 8;
- factor-graph landmarks: 36;
- reprojection RMSE: **2.29120 px -> 0.03318 px**;
- mean pose correction: **0.009729 m**;
- photo puzzle: 6 frames, 15 edges, 6 loops;
- photo graph connected fraction: **1.0**;
- live atlas connected fraction: **1.0**;
- live RGB coverage: **0.5100**;
- live Depth coverage: **0.5142**.

This is a regression/registration fixture, not a final-room-mesh benchmark.

## Other checks

- `npm run check:depth` — **PASS**
- `npm run check:layout` — **PASS**, 226 files under one V30 root
- `npm run check:deps` — **PASS**, 50 local references resolved
- `npm run check:constructors` — **PASS**, 5/5 EventTarget subclasses
- `npm run check:mock` — **PASS**, UI remains interactive after simulated WebXR failure
- `npm run check:alva` — **PASS**, Alva runtime contract
- syntax checks for `js/app.js`, `js/logger.js`, live graph/gate modules and live worker — **PASS**

## Diagnostic-specific observations

The mock UI failure path now produces a structured `handled-operation-error` checkpoint, confirming that caught high-level failures are persisted into the diagnostic stream rather than only printed to console.

Live diagnostic exports contain the complete factor-graph summary and the exact bounded graph window used by each optimiser generation, including frame IDs, excluded count and old loop endpoints. Accepted/rejected messages retain per-step timing and gate reasons.

## Drop-in patch validation

The incremental archive was extracted over a clean V30.37 project copy. The resulting tree is byte-for-byte equivalent to the V30.38 working tree (`diff -qr` empty).

On that overlay:

- 16 targeted boot/build/live-optimizer/diagnostic tests — **16/16 PASS**;
- layout — **PASS**;
- dependency closure — **PASS**;
- mock UI boot — **PASS**;
- Alva runtime contract — **PASS**;
- full `npm test` reproduces exactly **168/169 PASS**, with the same and only missing-model failure described above.
