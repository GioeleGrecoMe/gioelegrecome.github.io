# Room Scanner V30.17.0

Room Scanner uses **AlvaAR as the autonomous persistent visual SLAM tracker**.
Calibration is optional and only fixes a one-shot metric transform. It never
steers Alva after scanning starts.

## Reconstruction pipeline

```text
camera -> AlvaAR pose/world tracking
              |
              v
       local keyframe graph
              |
              +--> spatial/anchor novelty gate
              |             |
              |             v
              |    Depth Anything V2 Small
              |      (selected frames only)
              |             |
              |             v
              |    robust Alva-depth calibration
              |             |
              +-------------+
              |
              v
  AI-prior multi-view plane sweep
              |
              v
    surfel + sparse TSDF fusion
          |             |
          v             v
   live surface splats  TSDF mesh
```

Sparse Alva feature points are used for tracking/debugging, not directly turned
into Gaussian geometry. The live splats are derived from multi-view-confirmed
surfels; the mesh is derived from the TSDF.

## Scan behaviour

- `ALVA TRACKING`: tracking valid; keyframes/dense mapping may advance.
- `ALVA LOST`: world is frozen and dense mapping pauses.
- `ALVA RELOCALIZED`: Alva resumes in the same persistent world.
- `AI→ALVA`: relative AI depth has passed robust calibration on Alva anchors.
- `DEPTH AI+ALVA`: accepted dense depth samples after local-prior multi-view verification.
- `surf`: confirmed surface splats with multi-view support.
- The live mesh is shown over the camera after enough TSDF observations.

Move laterally and retain image overlap. Pure rotation gives little/no depth.
Textureless areas are rejected rather than hallucinated.

## Mobile resource budget

Dense reconstruction runs separately from Alva in module workers. It keeps at
most 8 downsampled 160x240 keyframes and processes one dense job at a time.
Depth Anything inference is intentionally sparse: a new call normally requires
at least 7 Alva depth anchors distributed over the image plus a new camera
position/view/depth context and at least 2.6 s from the previous request. Sparse
surfel/TSDF maps retain hard memory caps.

## Depth Anything

V30.17 uses `onnx-community/depth-anything-v2-small` through Transformers.js.
The q4 model is loaded lazily on the first useful keyframe, preferring WebGPU and
falling back to WASM. Its raw output is **not metric and is never fused directly**.
Instead, Room Scanner robustly calibrates it against reprojection-verified Alva
triangulated depths (metres when the metric bootstrap is locked), and uses the
result only to narrow the multi-view plane-sweep interval at each pixel.
Near-duplicate unprioritized views are skipped, preventing the old wide-search
camera-facing sheet from being fused just to fill holes.

The static shell and Alva tracking do not depend on the neural model. If the
Depth Anything runtime/model is unavailable in a scan, tracking remains active
and unsafe dense frames are dropped. See `docs/CHANGES_V30_17_0.md`.

## AlvaAR runtime

The application uses `vendor/alva_ar.js` when available, otherwise the validated
official runtime loader/cache path from V30.14.x. For a fully offline first
launch, vendor the official AlvaAR distribution in that location.

## Verification

```bash
npm run verify
```

See `docs/DENSE_MAPPING_GUIDE.md` for scan instructions.
