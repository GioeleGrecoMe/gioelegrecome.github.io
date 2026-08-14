# MobileSAM model files

The browser looks for these files first:

- `mobilesam.encoder.onnx`
- `mobilesam.decoder.quant.onnx`

The reference deployment pair is the same split encoder + quantized decoder used
by the public `MobileSAM-in-the-Browser` implementation. Install that pair on the
hosting machine with:

```bash
python3 tools/fetch_mobilesam_models.py
```

If you already have a compatible encoder+decoder ZIP, normalize it with:

```bash
python3 tools/install_mobilesam_zip.py /path/to/mobile_sam_bundle.zip
```

The web UI can also load a ZIP containing encoder+decoder ONNX directly into
browser memory. Every model path is validated by an actual encoder-to-decoder
smoke test on the target device before the guided object stage can start.

A compact third-party quantized MobileSAM ONNX bundle also exists, but ONNX
conversions may differ in preprocessing/layout. Use the browser smoke test as the
source of truth instead of assuming that any file named MobileSAM is compatible.
