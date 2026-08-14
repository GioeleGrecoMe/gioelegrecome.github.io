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

## Depth Anything V2 Small Q4F16 (optional Stage-5 detail prior)

The browser looks for:

- `depth_anything_v2_small_q4f16.onnx`

Install the pinned ~19.1 MB single-file ONNX model with:

```bash
python3 tools/fetch_depth_anything.py
```

Expected SHA-256:
`eca72971aea64216d767c70c534160de53b5435b588d362bac6dbd5a73f9bf1e`

The app can fall back to the Hugging Face model URL, but same-origin deployment
is preferred for repeatability and offline use.
