# Local neural model files

## MobileSAM (optional object isolation)

The browser looks for:

- `mobilesam.encoder.onnx`
- `mobilesam.decoder.onnx` (FP32 preferred)
- `mobilesam.decoder.quant.onnx` (quantized fallback)

The coherent split bundle follows the same browser-oriented layout used by the public `MobileSAM-in-the-Browser` integration.

Install with:

```bash
python3 tools/fetch_mobilesam_models.py
```

The UI can also load a ZIP/ONNX pair into browser memory. MobileSAM is used only
for the guided object step and released before the acoustic measurement.

## Depth Anything V2 Small Q4 (optional Stage-5 detail prior)

The browser looks for:

- `depth_anything_v2_small_q4.onnx` (runtime predefinito e verificato)
- `depth_anything_v2_small_q4f16.onnx` (fallback sperimentale)

Install the pinned ~26 MB single-file ONNX model with:

```bash
python3 tools/fetch_depth_anything.py
```

Expected SHA-256:
`5d55b02762e1907589158af3e366bd61ddf648155852a07bbf5e3a074639fcf8`

The app can fall back to the Hugging Face model URL, but same-origin deployment
is preferred for repeatability and offline use.
