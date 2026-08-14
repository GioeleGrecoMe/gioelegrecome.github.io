# ONNX Runtime Web runtime

MobileSAM uses the WASM path of ONNX Runtime Web 1.14.0 because the existing
MobileSAM browser implementation reports that version as the most compatible
with its converted encoder/decoder pair.

To make inference fully same-origin/offline on the deployment host, run:

```bash
python tools/fetch_onnxruntime_web.py
```

The application tries `./vendor/ort.min.js` first. If it is not present, it can
fall back to the pinned CDN runtime. The neural runtime is released before the
scientific measurement phase.
