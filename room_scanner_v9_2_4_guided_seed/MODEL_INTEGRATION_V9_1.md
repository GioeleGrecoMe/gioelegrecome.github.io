# v9.1 model integration notes

## Chosen backend

The concrete browser backend is EfficientSAM-Ti using the official separate ONNX encoder and decoder. The model adapter remains isolated from the map/object state so a later EdgeSAM/EdgeTAM-like backend can replace it without changing the fusion pipeline.

## Why split encoder/decoder matters

Object discovery needs several point prompts on one image. The expensive image encoder is therefore executed once. All prompts reuse the same image embedding and only execute the lightweight decoder.

The official exported decoder accepts:

- `image_embeddings`;
- `batched_point_coords` shaped `[B, Q, N, 2]`;
- `batched_point_labels` shaped `[B, Q, N]`;
- `orig_im_size`.

v9.1 uses one positive point per query and at most a handful of automatic queries selected from coherent RGB-D regions.

## Model selection policy

Auto mode only attempts the neural path when WebGPU is present, data-saver is not active and the reported device memory is not very low. Users can explicitly select neural mode to allow the WASM fallback.

## First-use/offline behavior

The archive does not contain third-party model binaries. The first neural use therefore needs either:

1. a network connection so the browser can fetch/cache the pinned official ONNX models and ONNX Runtime, or
2. local model/runtime files placed under `models/` and `vendor/`, or selected with the UI.

Once the model responses have been cached, the dedicated model cache survives normal application updates.

## Source references used for the integration

- EfficientSAM official repository: `https://github.com/yformer/EfficientSAM`
- EfficientSAM ONNX export: `https://github.com/yformer/EfficientSAM/blob/main/export_to_onnx.py`
- EfficientSAM ONNX wrapper: `https://github.com/yformer/EfficientSAM/blob/main/onnx_models.py`
- ONNX Runtime WebGPU documentation: `https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html`

## v9.2.3 local-weight integration

The actual upstream files are now bundled locally as
`models/efficient_sam_vitt_encoder.onnx` and
`models/efficient_sam_vitt_decoder.onnx`. The HTML no longer contains remote
model-weight URLs. Only ONNX Runtime Web is a separate dependency. The runtime
is local-first (`vendor/`) and can be vendored once with
`tools/fetch_onnxruntime_web.py`; the model itself never needs a network fetch.
