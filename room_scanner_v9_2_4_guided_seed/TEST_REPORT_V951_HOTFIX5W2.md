# Room Scanner v9.5.1 Hotfix5W2 - Test Report

Build: `v9.5.1-hotfix5w2-ort-metadata`  
Deploy revision: `951h5w2`

## Device error reproduced logically
Observed device error: `failed to call OrtRun(). error code = 2` for every MobileSAM encoder/decoder pair.

Root cause in H5W: `InferenceSession.inputMetadata` was accessed as `session.inputMetadata[inputName]`. ONNX Runtime JavaScript exposes metadata as an array of `ValueMetadata` objects and current tensor dimensions are in `shape`. Therefore the browser encoder's static `[684,1024,3]` shape was missed. The 96x64 smoke image used the dynamic long-side fallback and became `[683,1024,3]`, causing ONNX Runtime INVALID_ARGUMENT before decoder execution.

## Fix
- Array/map compatible `ortSessionMeta()`.
- `shape` / `dimensions` / `dims` compatible `ortMetaShape()`.
- Exact static encoder dimensions are honored.
- Phase-specific MobileSAM diagnostics report `ENCODER OrtRun` vs `DECODER OrtRun` and expected/actual tensor shapes.
- H5W warm preload, discreet progress bar, WebXR Gaussian fallback and Stage-5 fixes are retained.

## Regression test
A production-code probe with ORT-style metadata array verifies:
- browser export -> HWC/raw255 -> `[684,1024,3]` exactly;
- NCHW export -> ImageNet normalization -> declared static `[1,3,1024,1024]`;
- legacy map metadata remains accepted.

## Full suite
PASS: mapping, semantic/structural, virtual array, guided seed geometry, pruning, MobileSAM browser integration, bootstrap, Stage 3/5, Depth Anything, model/Gaussian hotfix, deploy integrity, warm AI reuse, compact object/material model, model metadata, ORT metadata regression, deep audit, metric depth alignment, worker shape.

Deep audit: 282 DOM IDs, 255 DOM refs, 100 handler targets, 634 named functions, 0 duplicate functions.
