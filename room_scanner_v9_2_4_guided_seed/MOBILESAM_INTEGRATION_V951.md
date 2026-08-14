# MobileSAM browser integration v9.5.1

## Expected local files

Place the split ONNX files at:

- models/mobilesam.encoder.onnx
- models/mobilesam.decoder.quant.onnx

The application also accepts a ZIP or two ONNX files from the startup UI. Uploaded model bytes are passed directly to ONNX Runtime Web and do not depend on HTTP model paths.

## Runtime

The application prefers a local ONNX Runtime Web 1.14 classic bundle:

- vendor/ort.min.js
- vendor/ort-wasm-simd-threaded.wasm
- vendor/ort-wasm-simd.wasm
- vendor/ort-wasm-threaded.wasm
- vendor/ort-wasm.wasm

The deployment helper tools/fetch_onnxruntime_web.py installs those assets. A pinned CDN fallback is retained for deployments that have not vendored the runtime.

## Model deployment helpers

- tools/fetch_mobilesam_models.py downloads the browser-reference MobileSAM encoder and quantized decoder pair used by the deployment contract.
- tools/install_mobilesam_zip.py installs a previously downloaded compatible ZIP without network access.

The generated archive does not embed the ONNX weight payloads. Hotfix2 uses the current PulpCut split MobileSAM ONNX repository as the pinned remote fallback, but deterministic GitHub Pages deployments should still vendor the same files under `models/` with `tools/fetch_mobilesam_models.py`. If preflight fails, Step 3 remains visible and reports the error instead of silently skipping.

## Execution policy

MobileSAM is never a background measurement task. It is invoked only after the user explicitly captures an object view and the metric readiness marker is green.

For each accepted view:

1. Capture the synchronized RGB frame associated with the metric keyframe.
2. Resize/pad for the MobileSAM encoder.
3. Run the encoder once.
4. Run the decoder with the center point prompt, or a box prompt when a manual boundary is available.
5. Convert the mask to metric 3D evidence using the synchronized depth and WebXR pose.
6. Store only temporary view evidence until the multi-view object proxy is finalized.

Sessions are released before acoustic measurement so the neural runtime does not compete with tracking, depth fusion, chirp acquisition, or DSP.
