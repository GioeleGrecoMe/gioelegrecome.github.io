# Test report - Room Scanner v9.5.1 Hotfix5W6

Build: `v9.5.1-hotfix5w6-verified-model-contracts`  
Deploy revision: `951h5w6`

## Model contract checks

PASS:

- MobileSAM pinned model identity table is present.
- Browser encoder contract resolves to `input_image [684,1024,3]`.
- Encoder embedding contract is `[1,256,64,64]`.
- Decoder exposes and receives all six required semantic inputs.
- `has_mask_input` is `[1]` and cannot collide with `mask_input [1,1,256,256]`.
- Bad encoder integrity is rejected before ORT inference.
- MobileSAM ORT proxy is disabled in H5W6.
- MobileSAM WASM override is resolved as an absolute URL.
- Depth Anything pinned model byte count is `19,126,267`.
- Depth Anything worker handles both static and dynamic NCHW model shapes.
- Dynamic landscape preprocessing resolves to `518x294`; static contract remains `518x518` where required by the model.
- Depth metric alignment accepts consistent direct/inverse mappings and rejects unrelated depth.

## Full regression suite

PASS:

- v9 mapping and geometry logic
- semantic structural logic
- virtual acoustic array
- seed geometry logic
- geometry pruning
- MobileSAM browser workflow
- JavaScript/bootstrap regression, including microphone and speaker handlers
- Step 3 and Stage 5 workflow
- Depth Anything integration
- WebXR Gaussian fallback
- deploy/cache integrity
- warm AI preload
- compact object/material export
- ORT metadata regression
- decoder input contract
- object tap selection and fullscreen viewer
- cooperative WebXR/SAM/DepthAI scheduler
- H5W6 verified model contract checks

Deep audit result:

- DOM IDs: 283
- simple DOM references: 256
- handler targets: 101
- named functions: 662
- duplicate named functions: 0

## H5W6 contract regression output

```text
status                    PASS
mobileSamEncoderInput     [684,1024,3]
mobileSamEmbedding        [1,256,64,64]
mobileSamDecoderInputs    6
depthAnythingPinnedBytes  19126267
mobileSamProxy            false
absoluteWasmPaths         true
badEncoderRejected        true
```

## Scope of verification

The test suite verifies the application code, runtime configuration, pinned model identities, metadata parsing, tensor construction, preprocessing/output contracts, cooperative scheduler and UI regressions. The large binary ONNX/WASM assets are not duplicated inside this source overlay; deploy-time byte/hash verification is performed by `tools/check_deploy_bundle.py`, and runtime preload performs real inference before acquisition.
