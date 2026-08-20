# Room Scanner V30.20.0

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
              |  quality gate + selected Alva keyframes only
              |             |
              |             v
              |    robust Deep -> Alva calibration
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
keyframes. Depth Anything has no free-running preview clock: it is requested
only after a keyframe has enough triangulated Alva anchors and contributes new
position/view/depth context (2.6 s minimum selector interval, 8 s forced refresh
ceiling). Sparse surfel/TSDF maps retain hard memory caps.

## Depth Anything

V30.20.0 reads the supplied local file
`models/model_q4.onnx` directly with ONNX Runtime Web; it
does not silently download/replace it with a Transformers.js model. On the home
screen, choose an alternative `.onnx` file if needed, then press **Prova
inferenza**. It captures one camera frame and reports the real backend (WebGPU
or WASM), output shape and execution time before a scan begins.

The supplied Q4 file is the right first choice: compact enough for mobile
and it exposes the expected `pixel_values` image input. It requires a browser
where the loaded ONNX Runtime Web build supports its Q4 MatMul operators. If the
pre-scan test reports an unsupported operator, use **Depth Anything V2 Small
FP16/FP32 exported for ONNX Runtime**, with one `pixel_values` NCHW input and
one depth output (not a MobileSAM encoder/decoder). The FP16 version is larger
but is the compatibility fallback; MobileSAM files in `models/` are segmentation
components and cannot produce a depth map on their own.

The camera path deliberately performs the resize and RGB/NCHW packing itself.
`Tensor.fromImage(ImageData)` is not used: with resize dimensions it can crop
the ImageData buffer instead of resampling it. The local Q4 graph is dynamic,
so the worker follows the model's DPT processor contract (ImageNet
normalization, aspect-preserving resize, 14 px patch multiples) but overrides
the upstream 518 px default with a 392 px mobile target. In portrait this is
typically about 266×392 instead of 350×518, reducing the neural raster by about
42% while Alva anchors and multi-view verification retain geometric authority.
The first `[batch, height, width]` output plane is read row-major.

Finite output is not automatically considered valid. A spatial-coherence test
detects isotropic "snow" maps (adjacent pixels as unrelated as distant pixels),
and the explicit pre-scan test also checks horizontal-flip equivariance. If a
suspicious WebGPU Q4 result disagrees with a structured one-shot WASM reference,
the worker disables WebGPU for that session and uses the safe WASM result.

Raw AI depth is **not metric and is never fused directly**. The color overlay is
now the same selected-keyframe result used by the geometry path. It is robustly
calibrated against reprojection-verified Alva triangulated depths using direct,
inverse-raw and disparity-like inverse-metric-depth fits, then accepted only
after multi-view plane-sweep verification.
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

For a browser/WebGPU regression without requesting camera access, open
`test/browser/depth-stock-harness.html` from a local static server. It runs the
shipped worker and `models/model_q4.onnx` against a public stock room image and
fails if the map has stripe/column signatures, isotropic-noise signatures or an
invalid tensor contract.

See `docs/DENSE_MAPPING_GUIDE.md` for scan instructions.
