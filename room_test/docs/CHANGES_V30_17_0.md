# V30.17.0 — sparse Depth Anything prior anchored to Alva geometry

## Why V30.16 could still create a floating sheet

V30.16 correctly anchored camera poses and sparse depth to AlvaAR, but the dense
surface was still selected by a wide photometric plane sweep. Repetitive indoor
texture, weak parallax and low-texture furniture can create plausible local
minima at a nearly camera-facing depth. Stable Alva feature points therefore did
not automatically imply a stable dense surface between those points.

## V30.17 reconstruction rule

Depth Anything V2 Small is restored only as a **relative shape prior**. It never
owns the camera pose and its raw output is never fused directly.

1. AlvaAR tracks the camera and supplies the persistent world pose.
2. Reprojection-verified Alva feature matches are triangulated into sparse depth
   anchors for a candidate reference keyframe.
3. The AI selector rejects near-duplicate photographs. Inference is requested
   only after enough anchors exist and the camera has contributed new position,
   view direction, depth context, or reached the maximum refresh interval.
4. Raw Depth Anything output is robustly fitted to the Alva anchor depths. Both
   direct and inverse raw-depth models are tested; outliers are removed and a
   high-residual calibration is rejected.
5. The calibrated dense map narrows plane sweep to a small local interval around
   each pixel. Alva-pose multi-view photometric agreement is still required for
   every accepted dense point.
6. Only those verified samples are integrated into surfels and the sparse TSDF.

This deliberately prioritizes coherent geometry over filling every frame. A
near-duplicate frame without an AI prior is skipped instead of being allowed to
create an unconstrained camera-facing sheet.

## Inference budget defaults

- at least 7 triangulated anchors across at least 3 screen cells;
- at least 2.6 s between AI requests;
- a new request normally needs >= 20 cm metric translation, >= 0.16 rad view
  rotation, or >= 22% change in median anchored depth;
- an 8 s maximum interval can refresh a sufficiently anchored view;
- only one dense/AI job is active at a time;
- Depth Anything uses the Small ONNX/Transformers.js model with q4 weights when
  supported, preferring WebGPU and falling back to WASM.

## Offline behavior

The static Room Scanner shell, Alva runtime cache path and non-AI scan controls
remain independent from the neural model. The Depth Anything runtime/model is
loaded lazily on the first selected keyframe. If it is unavailable in a scan,
Alva tracking continues and V30.17 drops unsafe unprioritized dense frames rather
than fabricating geometry. A local Transformers.js bundle can be placed at
`vendor/transformers/transformers.min.js`; otherwise the configured CDN fallback
is used.

## Diagnostics to inspect on phone

Look for `deep-depth-request`, `deep-depth-calibrated`, `deep-depth-skip`, and
`dense-depth-result` in exported diagnostics. A healthy room scan should show
many skipped duplicate views, relatively few AI requests, low calibration median
relative error, and dense results only after `AI→ALVA` calibration.
