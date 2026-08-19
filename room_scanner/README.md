# Room Scanner V30.0.0 — WASM SLAM + 3D Gaussian Twin

V30 is a clean-room rewrite of the scanner. It does not depend on V20 runtime files.

## What it does

- Uses `getUserMedia()` so the capture path is not tied to WebXR.
- Records IMU samples for later visual-inertial refinement.
- Runs a custom freestanding WebAssembly front-end (`wasm/slam_core.wasm`) for:
  - FAST-like feature detection;
  - BRIEF-style descriptors;
  - Hamming matching;
  - robust metric 3D-to-2D PnP refinement.
- Maintains persistent feature tracks and metric landmarks in a keyframe SLAM graph.
- Runs Depth Anything V2 Small on selected keyframes, WebGPU-first / WASM fallback.
- Calibrates monocular depth against existing SLAM landmarks; for the first map it can estimate scale from a visible floor plane and the user-provided camera height.
- Fuses depth/RGB observations into a dense incremental 3D Gaussian map in a Worker.
- Renders the Gaussian map as oriented elliptical splats using dependency-free WebGL2.
- Persists sessions incrementally in IndexedDB.
- Exports:
  - binary PLY Gaussian/RGB point cloud;
  - `.r30` raw session container with images, IMU, events and Gaussian state;
  - diagnostics JSON.
- Includes a decoupled short-ESS/RIR recording module for the later acoustic stage.

## Important definition

V30 is **incremental 3D Gaussian mapping**, not on-device differentiable 3DGS training.
The phone continuously estimates and fuses Gaussian means, covariance proxies, normals,
RGB, opacity/confidence and view support. Full photometric 3DGS optimization can be run
later from the exported keyframes, poses and Gaussian seeds.

This distinction is intentional: it avoids running a large differentiable optimizer next
to camera capture, WASM SLAM and neural depth inference on a thermally constrained phone.

## Deployment

Publish this directory as a static HTTPS site. `index.html` and
`room_scanner_v30.html` are equivalent entry points.

The core SLAM and Gaussian viewer work without third-party JS packages.
Depth Anything is local-first but the model/runtime are not bundled because they are much
larger than the application shell.

### Fully local Depth Anything

Populate:

```
vendor/onnxruntime-web/
models/depth_anything_v2_vits_q4.onnx
```

For ONNX Runtime Web, copy the relevant distribution files (JS + WASM support files) into
`vendor/onnxruntime-web/`. If those files are absent, V30 attempts the configured CDN
fallback and caches successful responses through the service worker.

Depth failure is non-fatal: keyframe JPEGs, WASM tracking, IMU and diagnostics continue to
be stored so the session can be processed elsewhere.

## First scan

1. Set approximately how high the phone camera is above the floor.
2. Start scanning.
3. Initially point at a reasonably textured patch of floor for a few seconds.
4. When `scala` obtains a confidence value, walk slowly around the room.
5. Cover walls, floor, ceiling and objects from multiple viewpoints.
6. Pin high-contrast persistent details when useful.
7. Stop; the same Gaussian map opens in the 3D viewer.

Do not expect the first seconds before the first successful depth keyframe to translate
accurately: the SLAM front-end can track rotation/features immediately, while metric
translation becomes much better once tracks acquire 3D landmarks.

## Debugging

Every keyframe is stored as a separate IndexedDB record before Deep processing. Errors are
stored as event records. Use `Diagnostica JSON` and `.r30` when reporting a device-specific
problem.

## Tests

```
./tests/run_tests.sh
```

The suite tests JavaScript syntax, the real WASM feature/matching core, WASM metric PnP,
depth calibration, static file contracts and JSON manifests.
