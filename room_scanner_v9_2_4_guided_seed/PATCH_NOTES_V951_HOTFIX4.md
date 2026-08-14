# v9.5.1 Hotfix4 — model/runtime + WebXR Gaussian recovery

## MobileSAM
- Same-origin ONNX assets are build-versioned and fetched network-first to avoid stale GitHub Pages CacheStorage.
- Binary sanity check rejects HTML/XML accidentally served as `.onnx`.
- Encoder preprocessing reads the declared ONNX input rank/static shape.
- FP32 `mobilesam.decoder.onnx` is preferred; quantized decoder remains fallback.
- Each decoder candidate must pass a real encoder->decoder inference smoke test before Step 3 is declared usable.
- Diagnostics expose decoder candidate and exact failure.

## WebXR Gaussian / Stage 5
- Before strict final pruning, the app snapshots the measured live WebXR Gaussian field.
- Structural/acoustic inference still uses strict validated geometry.
- If strict geometry becomes too sparse, Stage 5 visualisation merges the measured provisional snapshot so the old WebXR Gaussian map cannot disappear merely because multi-view validation is conservative.
- Viewer performs a synchronous first render and reports WebGL context loss explicitly.

## Cache
- Service worker/cache generation bumped to `951h4`.
- ONNX/WASM assets use network-first + offline cache fallback.
