# ONNX Runtime Web runtimes

Two isolated runtimes are intentional.

## MobileSAM

MobileSAM keeps its existing pinned ONNX Runtime Web 1.14.0 assets directly in
`vendor/` for compatibility with its split encoder/decoder conversion:

```bash
python3 tools/fetch_onnxruntime_web.py
```

## Depth Anything

The deferred DepthAI worker uses ONNX Runtime Web 1.24.1 under
`vendor/depthai/`. It can attempt WebGPU and fall back to WASM without changing
MobileSAM's global runtime (`vendor/ort.min.js` plus WASM binaries):

```bash
python3 tools/fetch_depthai_runtime.py
```

The remote CDN remains a fallback when local runtime assets are absent.
