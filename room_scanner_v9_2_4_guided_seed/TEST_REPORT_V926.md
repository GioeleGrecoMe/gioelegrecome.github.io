# Room Scanner v9.2.6 validation

- JavaScript module syntax: PASS
- service worker syntax: PASS
- DOM IDs: 249 / 249 unique
- named functions: 563 / 563 unique
- bundled EfficientSAM encoder SHA-256: PASS
- bundled EfficientSAM decoder SHA-256: PASS
- real `EfficientSAM-main.zip` fixture discovery: PASS
  - encoder: `EfficientSAM-main/weights/efficient_sam_vitt_encoder.onnx`
  - decoder: `EfficientSAM-main/weights/efficient_sam_vitt_decoder.onnx`
- model ZIP -> in-memory Uint8Array path: static regression PASS
- provider state-machine regression: WebGPU run failure -> WASM retry PASS
- semantic sessions released before scientific measurement: PASS
- inherited v9/v9.2 regressions: PASS

- Browser ZIP parser executed against the real uploaded `EfficientSAM-main.zip`: PASS (46 entries, both ONNX payload sizes exact)
- WebGPU incompatibility quarantine logic: static regression PASS
- uploaded model buffers released before scientific measurement: PASS
