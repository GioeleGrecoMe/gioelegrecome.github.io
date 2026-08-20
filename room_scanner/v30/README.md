# Room Scanner V30.18.0

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
              +--> local ONNX Depth Anything V2
              |             |
              |             v
              |  pre-scan inference test + 1 Hz live depth overlay
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

Alva runs at 256×384 / 8 fps from a low-resolution 640×480 camera stream. Dense
reconstruction remains in workers and keeps at most 8 downsampled 160×240
keyframes. Depth inference is separately rate-limited to one image per second;
if an inference takes longer, frames are dropped rather than queued. Sparse
surfel/TSDF maps retain hard memory caps.

## Depth Anything

V30.18 reads the supplied local file
`models/depth_anything_v2_small_q4f16.onnx` directly with ONNX Runtime Web; it
does not silently download/replace it with a Transformers.js model. On the home
screen, choose an alternative `.onnx` file if needed, then press **Prova
inferenza**. It captures one camera frame and reports the real backend (WebGPU
or WASM), output shape and execution time before a scan begins.

The supplied Q4F16 file is the right first choice: compact enough for mobile
and it exposes the expected `pixel_values` image input. It requires a browser
where the loaded ONNX Runtime Web build supports its Q4 MatMul operators. If the
pre-scan test reports an unsupported operator, use **Depth Anything V2 Small
FP16/FP32 exported for ONNX Runtime**, with one `pixel_values` NCHW input and
one depth output (not a MobileSAM encoder/decoder). The FP16 version is larger
but is the compatibility fallback; MobileSAM files in `models/` are segmentation
components and cannot produce a depth map on their own.

Raw AI depth is **not metric and is never fused directly**. It is first shown as
the color overlay, then robustly calibrated against reprojection-verified Alva
triangulated depths and accepted only after multi-view plane sweep verification.
This is what allows the resulting surfels, TSDF mesh and Gaussian display to
benefit from AI without creating a camera-facing monocular sheet.

The static shell and Alva tracking do not depend on the neural model. If the
Depth Anything runtime/model is unavailable in a scan, tracking remains active
and unsafe dense frames are dropped.

## AlvaAR runtime

The application uses `vendor/alva_ar.js` when available, otherwise the validated
official runtime loader/cache path from V30.14.x. For a fully offline first
launch, vendor the official AlvaAR distribution in that location.

## Verification

```bash
npm run verify
```

See `docs/DENSE_MAPPING_GUIDE.md` for scan instructions.
