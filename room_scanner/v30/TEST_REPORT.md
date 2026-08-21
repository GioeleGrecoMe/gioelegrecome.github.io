# V30.33.0 test report — continuous RGB + exact-frame Depth mosaic

## Scope

V30.33.0 changes only the acquisition/preview layer needed to make the live photographic map inspectable:

- the visible PHOTO mosaic is made from continuous RGB imagery, not point splats;
- no graph nodes, feature points, Alva markers, camera poses, or 3-D samples are overlaid on that preview;
- a camera photograph is admitted to the live mosaic only after a valid Depth Anything result returns for the exact same frozen frame;
- RGB alignment is photo-only; Alva is optional metadata and has no authority over mosaic placement;
- a photograph that has no reliable photographic overlap is not given a guessed location and is not visible in the root mosaic;
- dense SLAM keyframes are not injected into the user-visible photo mosaic;
- the existing 3-D reconstruction pipeline is intentionally unchanged.

## Automated suite

Command: `npm test`

Result: **140/141 PASS**.

The sole failing test is `bundled local ONNX model and mobile worker path are explicit`. The supplied project intentionally omits `models/model_q4.onnx`, so the filesystem assertion cannot pass. This is not a runtime regression introduced by V30.33.

New regression coverage includes:

- exact-frame RGB+Depth atomic admission;
- invalid/missing depth => no live mosaic node;
- unposed RGB+Depth frame remains a valid photographic node;
- dense SLAM keyframes cannot enter the visible mosaic;
- inverse-warped continuous RGB rendering (>99.5% filled area for the single-image fixture), with no point-splat renderer in the PHOTO path;
- localized RANSAC inliers cannot place a photograph even with low residual;
- absurd or missing Alva poses do not change the photographic mosaic;
- root component remains stable instead of jumping to another disconnected component;
- rotation-tolerant photographic descriptors and parallax/local-warp evidence.

## Public-data / real-texture validation

`npm run check:public`: **PASS** on the existing TUM RGB-D `freiburg1_xyz` fixture.

Key results:

- photographic features: 90
- matches: 86
- correct: 85
- precision: **98.8372%**
- recall: **100%**
- Photo Puzzle: 6 frames, 8 edges, 3 loops
- Photo Puzzle connected fraction: **100%**
- live atlas edges: 14
- live atlas connected fraction: **100%**
- live PHOTO coverage: 0.404921875
- live DEPTH coverage: 0.41056640625

The same exact-frame depth admission invariant is active in this validation.

## Other checks

All of the following pass:

- `npm run check:depth`
- `npm run check:layout`
- `npm run check:deps` — 39 local references resolved
- `npm run check:constructors` — 5/5 EventTarget-derived constructors valid
- `npm run check:mock` — UI remains interactive after expected mock WebXR failure
- `npm run check:alva` — Alva runtime contract

## Manual phone acceptance criteria

The build should be rejected if any of the following is observed in PHOTO preview:

1. isolated RGB dots or a point-cloud appearance;
2. graph edges, feature markers, pose markers, or 3-D samples drawn over the photograph;
3. a newly captured image appearing at an arbitrary location before a reliable RGB overlap is found;
4. an RGB frame entering the mosaic when its exact-frame Deep result failed or never arrived;
5. changing/losing Alva tracking causing the already-built RGB mosaic to jump.

The expected visible behavior is simply a growing continuous photographic mosaic. A frame either joins it through a verified RGB overlap or remains absent.
