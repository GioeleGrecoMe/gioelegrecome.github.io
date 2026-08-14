# H5W6 verified neural-model contract

Build: `v9.5.1-hotfix5w6-verified-model-contracts` (`951h5w6`).

## MobileSAM

The local default is the coherent `MobileSAM-in-the-Browser` split bundle. Before an ORT session is created, H5W6 verifies exact byte length and SHA-256 for encoder, FP32 decoder and quantized decoder. The runtime path is ONNX Runtime Web 1.14 WASM with `proxy=false`; local WASM assets use an absolute URL derived from `document.baseURI`.

Expected browser encoder contract:
- input `input_image`, float32 HWC `[684, 1024, 3]`, RGB in 0..255
- output `image_embeddings`, expected runtime tensor `[1, 256, 64, 64]`

Expected decoder inputs:
- `image_embeddings` `[1,256,64,64]`
- `point_coords` `[1,N,2]`
- `point_labels` `[1,N]`
- `mask_input` `[1,1,256,256]`
- `has_mask_input` `[1]`
- `orig_im_size` `[2]`

A real encoder->decoder smoke inference remains mandatory. The model is marked ready only if the embedding has the expected shape and `masks` is a rank-4 output.

## Depth Anything V2 Small Q4F16

The worker fetches the ONNX bytes itself, bypassing stale same-origin caches, and verifies:
- exact size: 19,126,267 bytes
- SHA-256: `eca72971aea64216d767c70c534160de53b5435b588d362bac6dbd5a73f9bf1e`

The worker requires one rank-4 NCHW input with three channels, uses ImageNet normalization, and verifies that the inference output contains a finite dense depth map whose data length matches its reported HxW. Local ORT WASM/JSEP paths are absolute worker-relative URLs.

## WebXR cooperation

These checks do not change the cooperative geometry design: WebXR remains the metric authority and continues to accumulate pose/depth/planes/Gaussians; MobileSAM is invoked only for the frozen selected RGB frame, and Depth Anything runs on sparse keyframes in its separate worker.
