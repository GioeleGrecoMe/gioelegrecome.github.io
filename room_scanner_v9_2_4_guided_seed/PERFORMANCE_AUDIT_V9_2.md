# v9.2.1 realtime performance audit

## Root cause versus v8

The regression from v8 to early v9 was primarily **work per observation**, not only the number of rendered Gaussians.

Early v9 combined several operations in the same realtime path:

1. fuse depth point;
2. scan local manifold neighbours;
3. reproject that surfel into a bounded history of RGB-D keyframes;
4. update existence probability;
5. periodically repeat comparable validation while rebuilding the full Gaussian field;
6. upload newly allocated GPU attributes;
7. occasionally run semantic and acoustic refinements.

A 32×24 depth grid contains 768 candidates. With an 18-frame reprojection history, the old placement could expose roughly `768 × 18 = 13,824` reprojection checks for one full grid before local-neighbour work. This is a complexity proxy, not a measured phone timing, but it explains why v9 could stall even with a moderate visible splat count.

## Hot-path changes

### Surfel insertion

`addSurfel()` now performs only cheap local accumulation/state updates. Full multi-view and manifold checks are queued.

### Validation

`processSurfelValidationBudget()` consumes a priority + round-robin queue using a fixed millisecond budget. The number of new depth samples no longer directly dictates how much validation must finish in that XR callback.

### Depth

Projection inverse, view-to-world transform and camera orientation are computed once per XRView. The full 32×24 metric depth grid is retained for map-frame evidence, while the live fusion stride adapts under load.

### Preview

Live preview uses a bounded representative surfel set. It does not consolidate the full scientific Gaussian field. Instanced GPU buffers use power-of-two capacity and are reused across refreshes.

### Map growth

Adaptive soft surfel caps reduce long-session JS-object/memory growth. Under load, fine detail is demoted/suppressed before native plane/mesh evidence. Final geometry is based on all retained stable evidence, not only the visible preview subset.

### RGB

Camera readback is 384×216 and adapts 2.5→0.6 fps. RGB is appearance/semantic evidence, not the metric pose/depth source.

### Semantics

Neural inference is never started from the arbitrary XR hot path during recording. Candidate frames queue and one job may run at a safe packet boundary when the governor is at L0. RGB boundary extraction is disabled before depth boundaries because depth boundaries are both cheaper and metrically more relevant.

### Acoustics

Live virtual-array splatting uses cached echo-only recent samples and bounded geometry/RIR counts. Full RT/EDC, complete Gaussian fields and surface inference are final-processing work.

### Structural inference

Furniture/primitive clustering and full surface reconstruction do not run during normal acquisition. Native XRPlane/XRMesh graph updates remain lightweight and are retained for the second stage.

## Governor levels

| Level | Preview | Depth fusion | RGB readback | Neural auto | RGB edge prior | Live acoustic |
|---|---:|---:|---:|---|---|---|
| L0 | 7000 | 1/1 | 2.5 fps | yes | yes | 360 nodes / 10 RIR |
| L1 | 4800 | 1/1 | 1.8 fps | no | yes | 220 / 8 |
| L2 | 2800 | 1/2 | 1.2 fps | no | no | skipped |
| L3 | 1600 | 1/3 | 0.6 fps | no | no | skipped |

Depth-keyframe storage and WebXR pose are not reduced by the preview count.

## Deep code audit checks

The final regression suite statically checks that these functions do not call final/full algorithms:

- `render()`
- `sampleDepth()`
- `addSurfel()`

It also verifies:

- reusable instanced Gaussian buffers;
- force-only primitive inference;
- recording-safe semantic queueing;
- lightweight admin/quality inspection during recording;
- live acoustic sample cache without RT/EDC computation;
- long-task governor escalation;
- diagnostic snapshot integration;
- service-worker and module syntax;
- duplicate DOM/function detection.

See `TEST_REPORT.md` for deterministic and synthetic results.
