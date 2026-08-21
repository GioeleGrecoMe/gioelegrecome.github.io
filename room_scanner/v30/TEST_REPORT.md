# V30.31 verification report

Build: `v30.31.0-20260821-photo-first-panorama-depth-consensus`

## Automated suite

`npm test` executes 133 tests in the supplied source tree. Result with the user-provided archive (where `models/` was intentionally removed):

- **132 PASS**
- **1 expected file-presence failure**: `models/model_q4.onnx` is absent
- **0 panorama/depth/GUI/pose regressions**

The failing ONNX assertion is a packaging check, not an inference or panorama failure. Restore the normal deployed `models/` directory and that test can run as designed.

Additional checks on this source tree:

- `npm run check:public`: PASS
- `npm run check:depth`: PASS
- `npm run check:layout`: PASS
- `npm run check:deps`: PASS, 39 local references resolved
- `npm run check:constructors`: PASS, 5/5 derived EventTarget classes
- `npm run check:mock`: PASS, including PHOTO/DEPTH switch and diagnostics dock open/close
- `npm run check:alva`: PASS

## New photo-first regressions

Dedicated tests verify that:

1. photographic registration still recovers the expected visual rotation when Alva orientation/position are deliberately wrong;
2. the global panorama graph follows visual edges rather than inheriting a bad Alva orientation;
3. raw Depth Anything maps with different affine scales are brought into one overlap-consensus coordinate;
4. the local photo warp reduces a synthetic residual-parallax displacement without using Alva translation;
5. live and post-scan panorama modules no longer use `matchProbabilisticFeatures`/Alva epipolar gating for photographic registration;
6. both published HTML entry points expose the camera-first collapsible measurement diagnostics UI;
7. local sessions and `.r30` retain panorama, raw-depth and Alva pose evidence needed for later pose correction.

## Public TUM fixture

The existing public TUM RGB-D `freiburg1_xyz` fixture is reused as a real-texture registration test with controlled geometry where an exact expected answer is available. It is not presented as a complete room-reconstruction benchmark.

Observed values after the V30.31 changes:

- trajectory samples: 3000
- duration: 30.0896 s
- path length: 9.1593 m
- real-texture feature matches: 86, of which 85 correct
- precision: **98.837%**
- recall: **100%**
- post-scan photo graph: 6 frames / 8 edges / 3 loop closures / **100% connected**
- live photo graph: 14 edges / **100% connected**
- PHOTO atlas support: 5.1523% of the full sphere
- DEPTH atlas support: 5.1504% of the full sphere
- independent factor-graph fixture: reprojection RMSE 2.2912 px -> 0.03697 px
- factor-graph fixture mean pose correction: 8.394 mm

The small spherical coverage is expected from the short narrow-FOV fixture. The relevant assertion here is connectivity and consistent PHOTO/DEPTH angular support.

## Scope

V30.31 changes acquisition registration, panorama/depth diagnostics, evidence persistence and measurement GUI. The later 3D reconstruction/mesh optimisation algorithms are intentionally unchanged. A future step can use the newly retained 2D correspondences + visual graph + Deep consensus + Alva pose covariance to optimise camera positions explicitly.
