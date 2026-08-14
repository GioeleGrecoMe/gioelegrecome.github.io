# Room Scanner v9.3 — Engineered Acquisition Workflow

## Decision: object selection belongs after a short map warm-up

The guided object step is intentionally placed **after** the first metric RGB-D/WebXR map and **before** acoustic excitation.

Why:

1. EfficientSAM only needs to segment a readable 2-D keyframe; it should not run continuously.
2. To turn the accepted mask into a useful 3-D prior, the application already needs valid camera pose, depth and a small multi-view baseline.
3. Running SAM before any map exists produces visually plausible masks with weak or unstable metric localization.
4. Running SAM after the acoustic measurement is too late to use object identity as a prior while the Gaussian map is being refined.
5. During the object step no chirp is emitted, so AI inference cannot interfere with scientific excitation/segmentation.

The resulting workflow is:

`Audio calibration -> Map warm-up -> Optional objects -> Acoustic measurement -> Twin`

## State-machine rules

### 1. Calibration

- Prepare microphone/output or load a previous calibration.
- No WebXR session is required.
- `Open AR scan` moves to Map.

### 2. Map warm-up

- WebXR pose, depth, XRPlane/XRMesh and RGB keyframes are acquired.
- No audio sweep is emitted.
- Live RGB Gaussian preview is allowed.
- Continue is enabled after a minimal geometric baseline; a soft escape becomes available when the runtime exposes limited geometry.
- **Back** closes XR and returns to calibration without invalidating the acoustic calibration.

### 3. Objects (optional)

- EfficientSAM is preflighted **only when entering this step**.
- The step is skipped automatically if encoder/decoder/runtime inference fails.
- UI is camera-first: reticle, mask, Segment, Confirm/Retry, object list, Back and Continue.
- A confirmed mask assigns visible depth/surfels to an object but does not artificially promote their geometric existence probability.
- Object deletion is available inside the XR DOM overlay.
- **Back** returns to the existing map; no map is reset.

### 4. Measurement

- SAM sessions are released before normal scientific measurement to recover memory/GPU resources.
- PCM recording and chirp batches start only here.
- Geometry continues to improve while measuring.
- **Back** pauses new chirps but preserves continuous PCM and all collected data. The user can revisit Objects/Map and then resume.

### 5. Twin

- Final cooperative processing produces the Gaussian visual/acoustic twin.
- The final viewer remains separate from acquisition.
- Closing the viewer returns to the review screen.

## Reversibility

Before measurement starts, Back is lossless.

After measurement starts, Back first pauses excitation. PCM already captured is kept; additional setup frames can be collected without emitting chirps. Returning all the way to calibration is explicitly confirmed because it terminates the active acquisition.

## Semantic failure policy

Semantic segmentation is never mandatory for metric mapping or acoustics.

Preflight order:

1. bundled/uploaded encoder + decoder presence;
2. ONNX Runtime initialization;
3. WebGPU smoke run if not quarantined;
4. WASM retry after any WebGPU creation **or run-time** failure;
5. if both fail, skip Objects and start measurement with a visible diagnostic reason.

## What remains primary

- Metric truth: WebXR pose + depth + XRPlane/XRMesh + multi-view reprojection.
- Visual representation: probabilistic surface Gaussian/surfel field.
- Object segmentation: sparse user-guided prior.
- Acoustic representation: virtual-array posterior splatted on geometrically supported Gaussian nodes.
- Structural surfaces/primitives: second processing, not a prerequisite for acquisition.
