V30.20.0 does not currently ship a bundled ONNX Runtime Web file.
Depth Anything is optional and the worker imports the configured official CDN
runtime only when the user tests/uses depth. This directory is intentionally not
referenced unless a real compatible ESM runtime is added.

For a fully offline deployment, place a matching `ort.all.min.mjs` here and set
CONFIG.deepOrtLocal to `../vendor/onnxruntime-web/ort.all.min.mjs`.
