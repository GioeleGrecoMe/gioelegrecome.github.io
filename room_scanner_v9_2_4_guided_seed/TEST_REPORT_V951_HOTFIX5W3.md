# Room Scanner v9.5.1 Hotfix5W3 Test Report

Build: `v9.5.1-hotfix5w3-decoder-input-contract`
Deploy revision: `951h5w3`

## Root cause fixed

H5W2 matched `mask_input` before `has_mask_input`. Since `has_mask_input` contains the substring `mask_input`, the decoder feed assigned the `[1,1,256,256]` mask tensor to `has_mask_input`, whose contract is `[1]`. ONNX Runtime rejected every decoder run with `ORT_INVALID_ARGUMENT` / error code 2.

H5W3 centralizes decoder feed creation in `buildMobileSamDecoderFeeds()` and uses the same builder in smoke-test and real segmentation.

## Decoder input contract

- image_embeddings: encoder output `[1,256,64,64]`
- point_coords: float32 `[1,N,2]`
- point_labels: float32 `[1,N]`
- mask_input: float32 `[1,1,256,256]`
- has_mask_input: float32 `[1]`
- orig_im_size: float32 `[2]`

## Regression suite

Full current suite: PASS.

- MobileSAM browser integration: PASS
- ORT encoder metadata regression: PASS
- decoder input collision regression: PASS
- warm preload reuse: PASS
- Step 3 visible failure/retry: PASS
- Depth Anything stage-5 path: PASS
- WebXR-only Gaussian fallback: PASS
- Stage 5 single WebGL renderer: PASS
- deploy/cache integrity: PASS
- bootstrap audio/speaker handlers: PASS
- DOM IDs: 282
- DOM refs: 255
- handler targets: 100
- named functions: 635
- duplicate named functions: 0
