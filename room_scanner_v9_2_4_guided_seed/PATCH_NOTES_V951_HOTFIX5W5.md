# Room Scanner v9.5.1 Hotfix5W5 — Cooperative WebXR + AI

Build: `v9.5.1-hotfix5w5-cooperative-xr-ai`  
Deploy revision: `951h5w5`

## Core invariant

WebXR is the metric backbone and remains active for the whole scan. MobileSAM and
Depth Anything never replace the XR map and never become metric authorities.

## Cooperative acquisition

- XR pose/camera rendering remains at the device callback rate.
- Expensive geometry fusion (XRPlane/XRMesh/depth) is capped to 10 Hz.
- Primary XR surfaces are rendered live as a light translucent overlay.
- Gaussian preview remains visible in Map, Objects, and Measurement.

## MobileSAM

- A user tap freezes one exact synchronized RGB-D map frame.
- That frozen frame is protected from bitmap/frame-ring eviction until the mask is
  consumed/confirmed.
- SAM sees the RGB photo only. Its mask is then back-projected with the synchronized
  XR depth/pose; SAM never segments the Gaussian cloud.
- ONNX Runtime Web 1.14 WASM proxy-worker mode is enabled when Worker is available,
  so MobileSAM inference is moved off the UI/main thread.
- A single AI mutex gives explicit SAM prompts priority over DepthAI.

## Depth Anything V2 Small Q4F16

- Keyframes continue to be captured during XR mapping.
- Every 5 accepted keyframes (minimum 8.5 s between runs), a background worker may
  infer relative depth if realtime load is safe.
- Each prediction is fitted to synchronized XR depth (direct and inverse-depth
  hypotheses); frames failing the robust metric gate are rejected.
- Accepted points enter the surfel/Gaussian map as low-weight `depthai` detail.
- Stage 5 still processes remaining unprocessed keyframes, so live deferrals do not
  lose refinement evidence.
- Scheduling uses a cumulative capture counter, not the capped 2–6 frame ring.

## Live surfaces

A dedicated `primarySurfaceGroup` visualizes persistent structural XR planes while
measurement continues. This layer is viewer guidance only; strict validated geometry
for the acoustic solver remains separate.

## UX / diagnostics

- DepthAI status reports `keyframe n`, countdown to next correction, queued state,
  provider, accepted metric points, and inference time.
- HUD reports primary plane count, DepthAI live-run count, `geo 10 Hz`, and RT level.
- MobileSAM displays only a compact non-blocking progress bar.
- Cooperative diagnostics include AI owner, warm SAM state/proxy mode, frozen frame,
  DepthAI live queue/runs/captures, and fused points.
