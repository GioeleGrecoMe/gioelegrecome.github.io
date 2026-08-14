# Room Scanner v9.5.1 Hotfix5W6

Build: `v9.5.1-hotfix5w6-verified-model-contracts`  
Deploy revision: `951h5w6`

## Why this hotfix exists

H5W5 reintroduced a fragile MobileSAM runtime configuration by enabling the ONNX Runtime WASM proxy while keeping a relative WASM override. The same release also used a relative local WASM base inside the Depth Anything worker. On a deployed GitHub Pages application those combinations can resolve assets from the wrong execution context even when the ONNX files themselves are valid.

H5W6 treats model availability as a verified contract, not as "the URL returned 200".

## MobileSAM

- Disables the implicit ORT WASM proxy for MobileSAM and returns to the browser-tested execution path.
- Resolves local WASM assets to an absolute URL before assigning `ort.env.wasm.wasmPaths`.
- Pins the exact expected byte count and SHA-256 of the browser MobileSAM encoder, FP32 decoder and quantized decoder.
- Validates the ONNX session contract before inference.
- Requires a real encoder -> decoder smoke inference before reporting `AI pronta`.
- Validates the actual encoder embedding as `[1,256,64,64]` and requires the decoder `masks` output.
- Preserves the fixed decoder feed contract from H5W3, including `has_mask_input=[1]`.

Expected browser contract:

- encoder input `input_image`: float32 `[684,1024,3]`, HWC RGB 0..255
- encoder output `image_embeddings`: `[1,256,64,64]`
- decoder inputs:
  - `image_embeddings`: `[1,256,64,64]`
  - `point_coords`: `[1,N,2]`
  - `point_labels`: `[1,N]`
  - `mask_input`: `[1,1,256,256]`
  - `has_mask_input`: `[1]`
  - `orig_im_size`: `[2]`

## Depth Anything V2 Small Q4F16

- The local WASM base in the dedicated worker is now absolute.
- The local model is fetched with cache bypass for verification and checked against the pinned size/SHA-256.
- The worker validates a rank-4 NCHW input with three channels.
- `Precarica AI` performs a real Depth Anything smoke inference, not only session creation.
- The returned depth plane must have the reported `H*W` sample count and at least 98% finite samples.
- Runtime/model contract and integrity data are exposed in diagnostics.

## Preload behaviour

`Precarica AI` now verifies both enabled AI components before the camera workflow begins:

1. runtime available;
2. exact model identity where pinned;
3. ONNX session contract;
4. real smoke inference;
5. output dimensions and finite values.

This is deliberately done before acquisition so a broken runtime/model pair cannot first fail in the middle of WebXR measurement.

## Cooperative WebXR pipeline preserved

The H5W5 cooperative architecture remains intact:

- WebXR pose/rendering remains the backbone;
- heavy geometry fusion is budgeted at approximately 10 Hz;
- MobileSAM works only on the frozen RGB-D snapshot explicitly selected by the user;
- Depth Anything runs in its own worker on periodic keyframes and is metrically gated against synchronized XR depth;
- primary XR surfaces and Gaussian preview remain live;
- the AI mutex prevents SAM and DepthAI inference from competing with each other, while WebXR never awaits AI.

## Deployment rule

This source overlay intentionally does not duplicate the large ONNX/WASM binaries. Keep the existing `models/` and `vendor/` directories when applying H5W6, or run the fetch scripts. `tools/check_deploy_bundle.py` now rejects wrong/truncated model binaries rather than merely checking that files exist.
