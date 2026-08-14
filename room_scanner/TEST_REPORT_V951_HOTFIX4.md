# Room Scanner v9.5.1 Hotfix4 — verification report

Build: `v9.5.1-hotfix4-model-runtime-gaussian-debug`

## Regressions addressed

- MobileSAM asset fetched but rejected as unusable: candidate decoder handshake now requires a real encoder→decoder inference smoke-test and exposes the exact candidate failure.
- FP32 decoder is preferred, quantized decoder is retained as fallback, followed by remote candidates.
- Same-origin ONNX/WASM requests are build-versioned/network-first to prevent stale GitHub Pages CacheStorage bytes after redeploy.
- ONNX binary sanity rejects HTML/XML error documents accidentally returned under a model URL.
- Encoder input preprocessing honors declared ONNX static/dynamic dimensions.
- WebXR-only Stage 5 no longer depends exclusively on the strict post-pruning field: a measured pre-pruning WebXR Gaussian snapshot is retained as a display-only fallback.
- Acoustic/structural solver continues to consume strict validated geometry only.
- Final Digital Twin viewer reuses the existing renderer and performs a synchronous first-render health check.

## Automated suite

`bash tests/run_current_suite.sh` returned exit code **0** on the build tree.

Hotfix4-specific assertions:

- model cache/network-first behavior: PASS
- FP32 decoder preferred: PASS
- quantized decoder fallback: PASS
- real MobileSAM self-test path: PASS
- WebXR display Gaussian fallback: PASS
- strict solver geometry isolation: PASS
- Stage 5 first-render probe: PASS
- prior bootstrap/audio/speaker regressions: PASS
- prior Step 3 / Stage 5 regressions: PASS
- Depth Anything metric-alignment tests: PASS

Deep audit at packaging time:

- DOM IDs: 276
- DOM references: 251
- handler targets: 100
- duplicate DOM IDs: 0
- duplicate named functions: 0

## Deployment requirement

Before publishing a self-contained/offline tree, run:

```bash
python3 tools/fetch_mobilesam_models.py
python3 tools/fetch_onnxruntime_web.py
python3 tools/fetch_depth_anything.py
python3 tools/fetch_depthai_runtime.py
python3 tools/check_deploy_bundle.py
```

Publish only after `FULL_LOCAL_READY=yes`.

The archive generated in this environment intentionally does not claim to contain remote neural binary payloads that could not be re-materialized here. It is designed to be extracted **over the existing repository folder**, preserving the already-published `models/` and `vendor/` binaries, then completed with the fetch commands above. In particular, the updated MobileSAM fetcher also installs `models/mobilesam.decoder.onnx` FP32.
