# MobileSAM browser integration v9.5.1 — Hotfix5W

## Expected local files

Preferred coherent browser bundle:

- `models/mobilesam.encoder.onnx`
- `models/mobilesam.decoder.onnx` (FP32)
- `models/mobilesam.decoder.quant.onnx` (quantized fallback)

Install/refresh them with:

    python3 tools/fetch_mobilesam_models.py

Hotfix5W fetches the encoder and decoders used by the MobileSAM-in-the-Browser
reference implementation. This avoids the older deployment mistake where a
PulpCut encoder could be stored under the same local filename while the browser
code assumed the HWC/raw-RGB input contract of a different export.

The application also accepts a ZIP or two ONNX files from the startup UI.
Uploaded model bytes are passed directly to ONNX Runtime Web.

## Runtime

The application prefers ONNX Runtime Web 1.14 classic WASM:

- `vendor/ort.min.js`
- `vendor/ort-wasm-simd-threaded.wasm`
- `vendor/ort-wasm-simd.wasm`
- `vendor/ort-wasm-threaded.wasm`
- `vendor/ort-wasm.wasm`

`tools/fetch_onnxruntime_web.py` installs those assets. A pinned CDN fallback is
retained.

## Export-contract adapter

The loader reads the encoder input metadata before creating the tensor:

- 3-D HWC input -> browser export, raw RGB float values in `0..255`;
- 4-D NCHW/NHWC / `pixel_values` input -> RGB rescale plus ImageNet
  normalization.

Local, browser-reference and PulpCut-compatibility encoder/decoder candidates are
smoke-tested as complete pairs. A file being downloadable or a session being
creatable is not sufficient: the pair is considered ready only after a real
encoder -> decoder inference produces a mask tensor.

## Warm-preload lifecycle

`Precarica AI` now creates a true warm in-memory session cache. Normal
Map -> Objects navigation reuses it and does **not** call `releaseSemanticSessions`
or recreate `InferenceSession`s. Only the explicit Retry button forces a reset.
Cold initialization uses the small pointer-transparent `#aiMiniProgress` bar so
the camera remains visible.

MobileSAM is still never a scientific measurement task. Sessions are released
before acoustic measurement so tracking, WebXR depth, camera capture and PCM/DSP
do not compete with the neural runtime.

## Model deployment helpers

- `tools/fetch_mobilesam_models.py` installs the coherent browser-reference split.
- `tools/install_mobilesam_zip.py` installs a compatible ZIP without browser
  downloads.
- `tools/check_deploy_bundle.py` verifies that models and matching runtime assets
  are actually present before publishing.

If preflight fails, Step 3 remains visible with Retry/upload/explicit skip and
the detailed failed encoder/decoder candidates are preserved in diagnostics.
