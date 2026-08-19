# Room Scanner V30.8.0 — selected multi-view WebXR landmarks

V30.8 changes only the metric bootstrap / hand-off strategy. The later camera-only
WASM SLAM, triangulation, MVS and Gaussian map remain independent from WebXR,
DeepAI and IMU.

## Calibration workflow

1. Start WebXR calibration and point at a part of the room containing fixed,
   distinctive visual details.
2. Blue circles are candidate regions with texture in both image directions.
   They are not semantic AI detections: the user decides which physical detail
   is reliable.
3. Tap 3–5 candidates. Each pin creates a small cluster of metric WebXR hit-test
   points so one object supplies several 3D→2D correspondences.
4. Keep the selected objects in view while moving laterally / vertically. Each
   object must be observed from at least three separated poses.
5. Finish by placing every selected object in one common view. The app captures
   that exact view and its templates as the hand-off keyview.
6. WebXR ends. The normal camera starts. Reproduce the common view; multi-view
   templates are matched around the saved keyview coordinates and the WASM PnP
   solver transfers metric pose/scale to camera-only SLAM.

## Diagnostics

The existing diagnostic panel logs candidate discovery, user pinning, metric
cluster acquisition, per-object view count/baseline, common-view readiness,
bridge template source, PnP inliers and RMSE.
