# V30 architecture

## 1. Capture layer

`CameraSource` supplies a 320-pixel-wide grayscale analysis stream and independent JPEG
keyframes. `ImuTracker` records acceleration, gravity and rotation-rate samples without
using inertial double integration as authoritative metric translation.

## 2. WASM SLAM layer

The freestanding `slam_core.wasm` has no Emscripten runtime. It exposes shared buffers and
implements feature extraction, descriptors, matching and robust 3D-to-2D PnP. JavaScript
owns track IDs, keyframe policy, map lifetime and diagnostics.

The separation makes it possible to replace the built-in core with an AlvaAR or
stella_vslam WASM adapter later without changing storage, depth or Gaussian code.

## 3. Metric bootstrap

Monocular scale is inherently ambiguous. V30 uses this hierarchy:

1. metric 3D landmarks already in the SLAM map;
2. a dominant floor plane observed by the first Deep keyframe plus entered camera height;
3. low-confidence nominal scale only as a temporary fallback.

Every keyframe stores the calibration source and confidence.

## 4. Deep layer

Depth Anything processes only selected keyframes. For a frame with metric anchors V30 fits
both direct depth and inverse-depth affine models and chooses the lower residual. The
result does not globally rescale existing geometry.

## 5. Gaussian map

The Gaussian Worker uses a metric voxel hash only as an indexing mechanism. Each occupied
cell is a 3D statistical primitive with:

- mean XYZ;
- accumulated covariance terms;
- averaged normal;
- RGB mean;
- observation count;
- independent frame/view count;
- temporal support;
- opacity/confidence proxy.

This is the primary geometric evidence. Plane/room/object extraction must consume the
Gaussian map later instead of replacing it during capture.

## 6. Viewer

The WebGL2 viewer instantiates an oriented elliptical quad per Gaussian and evaluates a
Gaussian alpha kernel in the fragment shader. This keeps the viewer dependency-free and
works even if WebGPU is unavailable.

## 7. Persistence

IndexedDB stores session metadata, JPEG keyframes, IMU chunks and event diagnostics in
independent records. A `.r30` export is a length-prefixed binary container rather than a
large base64 JSON snapshot.

## 8. Acoustic path

`js/audio/rir_recorder.js` provides a separate PCM + short ESS capture path. Future
processing should associate early RIR reflection hypotheses with stable Gaussian surface
zones while preserving uncertainty in absolute audio latency.

## 9. Next technical steps

- Add an Android WebXR metric adapter as an optional scale/pose constraint, not as the
  primary data model.
- Add loop closure and pose-graph optimization across keyframes/markpoints.
- Add multi-frame depth consistency before Gaussian insertion.
- Add free-space evidence from rays, not only occupied splats.
- Add offline/on-workstation photometric 3DGS refinement seeded from V30 Gaussians.
- Infer structural planes, floor/ceiling, objects and acoustic regions as derived graphs.
