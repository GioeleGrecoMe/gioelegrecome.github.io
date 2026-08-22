# V30.13.0 — AlvaAR pose + live AR reconstruction

## Why V30.12 looked poor

The V30.12 `wasm/slam_core.wasm` was only a 34-byte sentinel exporting `noop`; camera motion was produced by a small JavaScript optical-flow fallback. The Gaussian worker then voxel-averaged triangulated points and the review canvas rendered simple circles. That path exercised the pipeline but was not equivalent to AlvaAR + 3D Gaussian Splatting.

## V30.13 changes

- Real AlvaAR is now the primary camera-pose source when `vendor/alva_ar.js` is present or the configured upstream CDN fallback loads.
- The WebXR pin calibration supplies the metric world reference. Alva orientation is aligned immediately; its monocular translation scale is estimated from calibrated local motion before metric Alva translations are used.
- Camera frames are center-cropped instead of stretched. Intrinsics are remapped to the exact crop and the inverse crop mapping is retained for AR overlay registration.
- MVS receives the same metric pose/intrinsics used by the live renderer. Matching is pose-guided: descriptor candidates must satisfy the calibrated epipolar line, ray-gap and reprojection gates before they can create a 3-D sample.
- Online splat fusion now tracks observation support, confidence, per-axis variance, neighbourhood support and rejects inconsistent updates. Isolated one-view floaters are hidden immediately; splats need independent multi-view or local spatial support before they are displayed.
- `miniMap` is repurposed as a transparent live reconstruction canvas on top of the camera. The user can cycle `AR: GS -> GS+Mesh -> Mesh -> Off`.
- A coarse metric mesh is rebuilt periodically in a worker and can be drawn as AR wireframe during scanning.
- Review viewer now has a visible ground grid/axes and supports one-finger orbit, two-finger pan/pinch, wheel zoom, double-click fit, plus Top/Front/Side presets.

## Important terminology

The real-time browser worker is a robust multi-view **splat/surfel fusion map**, not the differentiable training pipeline of the original GraphDeco 3DGS implementation. It does not optimize spherical harmonics or anisotropic covariance against a photometric loss. The UI keeps `GS` for continuity, but the diagnostics explicitly report the tracking source (`ALVA SLAM` vs `SLAM FALLBACK`).

## AlvaAR deployment

For fully self-contained operation, place the official GPLv3 AlvaAR `dist/alva_ar.js` at `v30/vendor/alva_ar.js`. If absent, V30.13 tries the configured jsDelivr mirror of the upstream repository; if both paths fail, it continues in a clearly labelled low-quality fallback mode.
