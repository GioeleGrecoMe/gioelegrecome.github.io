# Scan Test v2.4.0 - verification record

Build: `scan-test-v2.4.0-native-tracker-safe-depth`

## Evidence from the supplied failing MHT

The captured browser session reports:

- Alva raster: 320x240
- camera source raster: 480x640
- recording/tracker sampling: 8 Hz
- archived frames: 107
- Alva offline poses: 0
- Deep provider: WebGPU
- Deep output: 294x224
- Deep input mode: `dpt-aspect-224`
- the old quality gate accepted the visually random map as non-suspicious

This is the v2.2 execution path, not the corrected v2.4 path.

## Root causes addressed in v2.4

1. Live Alva tracking cadence was still coupled to archive cadence. The archive slider no longer throttles the tracker; camera frames are delivered at presentation cadence.
2. The visual-SLAM raster is 640x480 rather than the old 320x240 path visible in the failing capture.
3. Uploaded video uses native decoded-frame stepping through `requestVideoFrameCallback` and `mediaTime`, with a unique-frame seek fallback.
4. A dynamic Alva fixture is actually shipped with the patch and is referenced by the UI.
5. Offline replay can probe plausible FOV values only when the requested FOV yields exactly zero poses; a candidate is accepted only if Alva itself measures poses.
6. Deep preflight and reconstruction share one 518-pixel short-side preprocessing contract.
7. This diagnostic build forces WASM, requests CPU output, and requires flip-equivariance before a depth map may be used.
8. Version labels and module/worker query strings are all v2.4.0 so stale/partial deployment is visible immediately.

## Executed regressions on the delivered files

### JavaScript syntax

`node --check` passes for:

- `app.js`
- `camera.js`
- `deep_depth_worker.js`

### Alva old-path reproduction / resolution regression

Same dynamic fixture:

- v2.2-like 320x240 at 8 fps: 32 frames, 0 poses
- 320x240 at 30 fps: 120 frames, 0 poses
- corrected 640x480 at 30 fps: 120 frames, 76 poses, first pose frame 44

This is important: simply increasing temporal cadence does not repair the reproduced failure at 320x240. The 640x480 SLAM raster is a functional fix, not a cosmetic resolution increase.

### Alva direct MP4 regression

Dynamic fixture, 640x480, horizontal FOV 60 deg:

- frames: 120
- valid poses: 76
- pose ratio: 0.6333
- first pose: frame 44
- median frame points: 35 in the latest run

### Alva browser MediaStream regression

The dynamic MP4 was exposed to `CameraController` as a live `MediaStream`, with the controller configured so archive cadence cannot throttle Alva:

- tracking callbacks: 121
- valid poses: 69
- first pose: callback 52
- median Alva frame points: 70
- `requestVideoFrameCallback`: available

### Depth static/contract regression

`test_depth_contract.mjs` passes:

- model input: `pixel_values`, float32, NCHW, dynamic H/W
- model output: `predicted_depth`, float32, H/W preserved at ViT patch granularity
- test input tensor: 1x3x518x518
- strict output shape: PASS
- strict RGBA shape: PASS
- full raster RGB/NCHW round-trip: PASS
- flip gate helper: PASS

## Explicit Depth limitation

A true numerical ONNX Runtime WASM inference could not be executed inside this sandbox because ORT is not installed locally and the sandbox cannot resolve/download the CDN runtime artifacts. No numeric Deep success is claimed. The delivered browser code is deliberately fail-closed: it will not accept the noisy WebGPU path seen in the supplied MHT, and it will expose provider/flip failure in diagnostics rather than constructing geometry from it.
