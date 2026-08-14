# EfficientSAM browser integration — offline deployment

The EfficientSAM model itself is already integrated and bundled. No model-weight request to GitHub or Hugging Face is made by Room Scanner.

The browser still needs an ONNX executor. Room Scanner v9.2.4 is pinned to `onnxruntime-web 1.27.0` and first attempts:

- `vendor/ort.webgpu.bundle.min.mjs`
- `vendor/ort-wasm-simd-threaded.jsep.mjs`
- `vendor/ort-wasm-simd-threaded.jsep.wasm`

These files must come from the **same ONNX Runtime Web version**. The easiest deployment-time installation is:

```bash
python tools/fetch_onnxruntime_web.py
```

Alternatively:

```bash
npm install onnxruntime-web@1.27.0
cp node_modules/onnxruntime-web/dist/ort.webgpu.bundle.min.mjs vendor/
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs vendor/
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm vendor/
```

After those three files are present, the EfficientSAM path no longer requires network access during use. The service worker caches model/runtime resources lazily rather than downloading the ~41 MB model during page startup.

If the runtime is absent or fails, the rest of Room Scanner remains operational and guided seeding can fall back to a lower-confidence RGB-D connected-region proposal.
