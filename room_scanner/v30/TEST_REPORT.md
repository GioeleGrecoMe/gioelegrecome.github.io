# V30.34.0 test report — robust spherical panorama + global Depth scale

## Scope

V30.34 changes only the photographic/depth evidence layer before the existing 3-D reconstruction:

- exact-frame RGB+Depth admission remains mandatory;
- photographic registration is now rigid spherical rotation, not a planar homography;
- multi-scale photo matching and wider relocalisation improve live connectivity;
- all raw Depth Anything maps are jointly aligned into one global affine latent scale;
- the Depth atlas uses one shared global colour range;
- AlvaAR remains optional metadata for this stage.

## Node test suite

`npm test`:

- total: **143**
- passed: **142**
- failed: **1**

The sole failure is `bundled local ONNX model and mobile worker path are explicit`, because the supplied project intentionally omits `models/model_q4.onnx`. The application/model-path code is unchanged by this patch; the filesystem assertion cannot pass until the existing `models/` directory is restored beside the patch.

All spherical panorama, photo-only authority, exact-frame depth admission, continuous renderer, global Depth consensus, boot/cache and existing reconstruction tests pass.

## Public TUM validation

`node tools/validate_public_data.mjs` passes on the retained public TUM fixture:

- feature matching precision: **98.84%**
- recall: **100%**
- photo puzzle: **6/6 frames connected**
- photo-puzzle edges: **15**
- photo-puzzle loop edges: **6**
- live atlas connected fraction: **100%**
- live atlas edges: **15**
- RGB coverage: **0.510**
- Depth coverage: **0.514**
- factor-graph reprojection RMSE: **2.291 px → 0.037 px**

The public-data fixture is a controlled registration/graph validation, not a full panorama or room-reconstruction benchmark.

## Additional checks

- Depth worker diagnostics: **PASS**
- V30 layout/build identity: **PASS**
- local dependency closure: **PASS** (39 references)
- EventTarget constructors: **PASS 5/5**
- mock UI boot/recovery: **PASS**
- AlvaAR runtime contract: **PASS**

## New invariants exercised

- absurd or missing Alva poses do not change spherical RGB registration;
- spherical transforms remain orthonormal and cannot shear/stretch a photograph;
- the first panorama component remains the fixed visible gauge;
- localized accidental match clusters are rejected;
- the RGB preview is dense inverse warping, never point splatting;
- Depth maps from different frames are solved into one shared overlap scale before colouring;
- projective/local mesh photo warping is disabled.
