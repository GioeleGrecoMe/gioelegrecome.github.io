# Room Test validation

Validation performed on the supplied V30.51 tree.

## New diagnostic suite

`npm run test:room-test`

Result: **3/3 PASS**

- coherent multi-camera synthetic geometry: no hard diagnostic failure;
- intentionally corrupted focal length: first weak stage localized at T1 Camera intrinsics;
- full four-way optimizer ablation: input factor graph remains unchanged.

## Dependency closure

`npm run check:deps`

Result: **PASS** (`68` local references resolved, `5` ESM roots imported by the original checker). A separate check also verifies every local import and HTML asset added by `room_test.html` exists.

## Existing V30 suite

The complete `npm test` run reaches **277 passing / 2 failing** tests in this uploaded tree. Both failures are reproducible in the untouched uploaded V30 and are not introduced by Room Test:

1. `sharp photo-first atlas uses best-source compositing instead of blur-producing image averaging` already fails in the supplied `tests/live-photo-puzzle.test.mjs`.
2. `bundled local ONNX model and mobile worker path are explicit` fails because `models/model_q4.onnx` is absent, consistent with the package being supplied without model weights.

Room Test itself does not require the ONNX model because it consumes already-persisted compact Deep grids.
