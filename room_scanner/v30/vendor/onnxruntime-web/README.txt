V30.1 does not require a bundled ONNX Runtime file to bootstrap.
Depth Anything is optional and loaded by workers/depth_worker.js via a local
Transformers.js module when provided, otherwise via the configured CDN.
For a fully offline deployment, place a compatible Transformers.js ES module at:
  vendor/transformers/transformers.min.js
and populate its model cache or adapt js/config.js to a local model path.
