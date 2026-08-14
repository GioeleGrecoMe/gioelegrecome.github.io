# SAM model ZIP input

Room Scanner v9.2.6 accepts either two ONNX files or one ZIP from **Carica SAM ZIP / ONNX**.

The ZIP may contain arbitrary folders. The browser searches recursively for:

- a filename matching `*encoder*.onnx`
- a filename matching `*decoder*.onnx`

The upstream `EfficientSAM-main.zip` is accepted directly and resolves to:

- `EfficientSAM-main/weights/efficient_sam_vitt_encoder.onnx`
- `EfficientSAM-main/weights/efficient_sam_vitt_decoder.onnx`

The files are decompressed in the browser and passed as `Uint8Array` model buffers to ONNX Runtime. No HTTP URL is used for uploaded model bytes.

This does **not** replace ONNX Runtime Web itself. The runtime still needs either the deployed `vendor/` assets or the pinned runtime fallback configured in the HTML.
