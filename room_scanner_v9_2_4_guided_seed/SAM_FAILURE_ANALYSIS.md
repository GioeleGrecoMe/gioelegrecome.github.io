# EfficientSAM preflight failure analysis

Source: `room_scanner_diagnostic_1786704808743.zip` supplied from the phone.

## What actually failed

The diagnostic proves that the EfficientSAM ONNX weights were reached and the ONNX sessions were created. The failure occurs later during inference:

- local runtime import failed because `./vendor/ort.webgpu.bundle.min.mjs` was not deployed;
- the application therefore loaded the pinned ONNX Runtime Web fallback;
- WebGPU session creation succeeded;
- `OrtRun()` failed in a WebGPU `Softmax` bind-group validation step;
- the old preflight did not retry WASM because its WASM fallback only covered **session creation**, not **runtime execution**.

The important excerpt is conceptually:

`WebGPU validation failed ... BindGroupDescriptor "Softmax" ... CreateBindGroup(...)`

This is an execution-provider compatibility/runtime problem on that browser/GPU path, not a missing EfficientSAM encoder/decoder.

## v9.2.6 correction

- End-to-end provider smoke test is provider-specific.
- WebGPU `run()` failure causes full session/tensor release and explicit WASM recreation.
- Full encoder -> decoder smoke inference is repeated on WASM.
- Guided object selection is entered only after one provider passes.
- Provider attempts and errors are recorded in the Diagnostic ZIP.
- Runtime failure during a later guided segmentation retries once on WASM.
- Encoder and decoder can alternatively be supplied as one ZIP and are loaded directly from browser memory.

## Deployment note

The published repository contains both EfficientSAM ONNX files under `models/`, but the inspected `vendor/` directory contains only its README. For fully offline inference, deploy the ONNX Runtime Web assets listed in `vendor/README.md`. Until then the runtime module can still use the pinned CDN fallback; the model weights themselves do not need remote downloads.
