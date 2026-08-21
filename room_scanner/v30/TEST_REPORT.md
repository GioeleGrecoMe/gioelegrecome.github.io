# V30.37.0 test report · causal feedback / confirmed geometry

## Full regression

`npm test`: **162 tests, 161 PASS, 1 expected environment failure**.

The only failure is `tests/local-onnx-depth-ui.test.mjs`, which performs `stat()` on `models/model_q4.onnx`. The user-supplied project intentionally omits `models/`; V30.37 neither changes nor redistributes model weights.

## New V30.37 feedback tests

`tests/feedback-estimator.test.mjs`: **9/9 PASS**.

It covers:

- panorama index -> persistent `frameId` conversion;
- spatial residual classification (pose-like field vs localized Deep failure);
- switchable relative Alva translation under RGB contradiction;
- leave-one-view-out support and independent triangulation-angle counting;
- rigid submap loop correction;
- committed Deep requiring independent confirmation;
- image-only RGB quality diagnostics;
- persistence/restoration of RGB and Alva switch posterior states;
- faster RGB/pose loop vs slower Deep feedback loop.

## Public-data / runtime validation

- `check:public`: PASS;
- TUM RGB-D `freiburg1_xyz`: 85/86 correct real-texture matches = **98.84% precision**, **100% recall**;
- TUM factor graph reprojection RMSE: **2.2912 px -> 0.0332 px**;
- mean pose correction on fixture: **9.73 mm**;
- photo puzzle: **6/6 frames, 15 RGB edges, 6 loops, 100% connected**;
- live atlas: **15 edges, 100% connected**;
- `check:depth`: PASS;
- layout: PASS, **220 files** in the project root before packaging;
- dependency closure: PASS, **49 local references**;
- EventTarget constructor check: **5/5 PASS**;
- mock UI boot: PASS;
- AlvaAR runtime contract: PASS.

The TUM fixture is a registration/regression check, not a benchmark of final dense reconstruction accuracy.

## Incremental overlay validation

The final V30.37 archive was applied over a clean V30.36 tree and tested from that reconstructed tree:

- focused feedback/build/boot/panorama contracts: **23/23 PASS**;
- layout: PASS, **220 files**;
- dependency closure: PASS, **49 local references**;
- full `npm test`: **162 total, 161 PASS**, with the same single expected missing-model failure (`models/model_q4.onnx`).
