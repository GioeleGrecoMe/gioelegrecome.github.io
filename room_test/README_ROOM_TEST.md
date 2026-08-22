# Room Test · V30.51 Geometry Lab

`room_test.html` is a read-only diagnostic clone for Room Scanner V30.51. It reuses the production camera, SLAM math, factor-graph and optimizer code, but never writes diagnostic results back to a scan.

## Run

Serve this directory from the same HTTPS origin/path family used by Room Scanner and open `room_test.html`. A static HTTP server is sufficient for desktop testing; IndexedDB session reuse requires the same browser origin that created the V30 sessions.

Data sources:

- **IndexedDB**: loads a saved V30 session and its persisted factor graph.
- **R30**: loads an exported `.r30` without requiring the neural model files.

The test page does not run Depth Anything inference. It diagnoses the Deep grids already persisted in the factor graph. This keeps the test independent from model availability and inference performance.

## Diagnostic order

- T0 Frame identity / data contract
- T1 Camera intrinsics / pixel-to-ray + production crop-helper round trip
- T2 Alva pose sanity / trajectory
- T3 Pose convention: stored `T_wc` interpretation vs inverse hypothesis
- T4 RGB epipolar consistency using saved photo correspondences
- T5 RGB triangulation and ray-gap/parallax checks
- T6 Sparse landmark reprojection
- T7 Deep frame binding and RAW integrity
- T8 Robust Deep-to-sparse-RGB depth transfer (`direct`, `inverse-raw`, `inverse-depth`)
- T9 Per-frame stability of the chosen Deep transfer mode
- T10 Cross-view Deep consistency by unproject/reproject comparison
- T11 Full mode only: four read-only optimizer ablations (`RGB`, `RGB+Alva`, `RGB+Deep`, `ALL`)

The UI highlights the first FAIL, otherwise the first WARN. Later tests are still computed so the exported report contains evidence for secondary problems.

## Important limitation of historical R30 files

The production V30 factor graph persists camera intrinsics, frame IDs, pose priors/estimates, photo thumbnails/features and compact Deep grids. It does **not** normally persist the native video raster/crop metadata or an independent pose-clock history. Therefore `room_test.html` can verify the production crop math itself and the persisted K consistency, but an old `.r30` cannot reconstruct the exact native-camera crop for each historical frame. This is explicitly reported in T1 rather than silently guessed.

Alva pose timing is less ambiguous than a separate IMU/camera pipeline because production V30 calls `slam.process(frame)` on the exact `CameraController.capture()` frame and the resulting Alva pose/keyframe inherits that same `frameId`. T0 therefore audits exact frame binding; a separate artificial time-offset sweep would not describe how this code actually obtains Alva poses.

## Tests

The package adds `tests/room-test-geometry-diagnostics.test.mjs`, which creates a known multi-camera slanted plane with analytic inverse-depth and verifies:

1. coherent geometry produces no hard diagnostic failure;
2. a deliberately corrupted focal length is detected at the camera stage;
3. the full optimizer ablation does not mutate the input graph.
